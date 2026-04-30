// Edge function: gmc-diagnostics
//
// Fetches product status / item-level issues from Google Merchant Center using
// the Merchant API and returns a structured response for the Feed Dashboard.
//
// POST body:
//   { productId?: string, limit?: number, pageToken?: string }
//
// Auth: OAuth 2.0 via Google service account (JWT bearer flow, RFC 7523).
// Required Lovable Cloud secrets:
//   - GMC_SERVICE_ACCOUNT_JSON  → full service-account JSON (string)
//   - GMC_MERCHANT_ID           → numeric Merchant Center account id
//
// Scope: https://www.googleapis.com/auth/content
//
// Endpoints used (Content API v2.1, accessible via merchantapi.googleapis.com):
//   GET /content/v2.1/{merchantId}/productstatuses
//   GET /content/v2.1/{merchantId}/productstatuses/{productId}

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ───────────────────────── Types ─────────────────────────

interface ItemLevelIssue {
  code: string;
  servability: "disapproved" | "demoted" | "unaffected" | string;
  resolution: string;
  attributeName?: string;
  destination?: string;
  description: string;
  detail?: string;
  documentation?: string;
  applicableCountries?: string[];
  numberOfItems?: number;
}

interface DestinationStatus {
  destination: string;
  status: "approved" | "pending" | "disapproved" | string;
  approvedCountries?: string[];
  pendingCountries?: string[];
  disapprovedCountries?: string[];
}

interface ParsedProduct {
  id: string;
  title: string | null;
  feedStatus: "eligible" | "warning" | "disapproved" | "pending" | "unknown";
  destinationStatuses: DestinationStatus[];
  itemLevelIssues: ItemLevelIssue[];
  productInapplicability: string[];
  apparelChecks?: ApparelChecks;
  imageChecks?: ImageChecks;
}

interface ApparelChecks {
  isApparel: boolean;
  missing: string[]; // e.g. ["color","gender","age_group","material","size","pattern","condition"]
}

interface ImageChecks {
  meetsMinSize: boolean | null;
  width: number | null;
  height: number | null;
  warnings: string[]; // e.g. ["below_min_250", "watermark_suspected", "text_overlay_suspected"]
}

const APPAREL_REQUIRED = [
  "color",
  "gender",
  "ageGroup",
  "material",
  "sizes",
  "pattern",
  "condition",
] as const;

// ───────────────────────── OAuth (service account) ─────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    bin,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const key = await importPkcs8(sa.private_key);
  const now = getNumericDate(0);
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/content",
      aud: tokenUri,
      iat: now,
      exp: getNumericDate(60 * 60),
    },
    key,
  );

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token exchange failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("No access_token in OAuth response");
  return body.access_token as string;
}

// ───────────────────────── Parsing ─────────────────────────

function deriveFeedStatus(
  destinations: DestinationStatus[],
  issues: ItemLevelIssue[],
): ParsedProduct["feedStatus"] {
  if (issues.some((i) => i.servability === "disapproved")) return "disapproved";
  if (destinations.some((d) => d.status === "disapproved")) return "disapproved";
  if (destinations.some((d) => d.status === "pending")) return "pending";
  if (issues.some((i) => i.servability === "demoted")) return "warning";
  if (destinations.some((d) => d.status === "approved")) return "eligible";
  return "unknown";
}

function checkApparel(product: any): ApparelChecks {
  const category: string =
    product?.googleProductCategory ||
    product?.product?.googleProductCategory ||
    "";
  const productType: string = product?.productTypes?.[0] || product?.productType || "";
  const isApparel =
    /apparel|clothing|accessor/i.test(category) ||
    /apparel|clothing|accessor/i.test(productType);

  const missing: string[] = [];
  if (isApparel) {
    const src = product?.product ?? product;
    const checks: Record<string, unknown> = {
      color: src?.color,
      gender: src?.gender,
      age_group: src?.ageGroup,
      material: src?.material,
      // Merchant API exposes sizes as an array
      size: Array.isArray(src?.sizes) ? src.sizes[0] : src?.sizes,
      pattern: src?.pattern,
      condition: src?.condition,
    };
    for (const [k, v] of Object.entries(checks)) {
      if (v == null || v === "") missing.push(k);
    }
  }
  return { isApparel, missing };
}

async function checkImage(imageLink: string | undefined): Promise<ImageChecks> {
  const result: ImageChecks = {
    meetsMinSize: null,
    width: null,
    height: null,
    warnings: [],
  };
  if (!imageLink) return result;

  try {
    // HEAD to avoid downloading the full bytes; many CDNs don't return dims
    // in headers, so we fall back to fetching the first ~32KB and parsing.
    const res = await fetch(imageLink, { method: "GET" });
    if (!res.ok || !res.body) return result;
    const buf = new Uint8Array(await res.arrayBuffer());
    const dims = readImageSize(buf);
    if (dims) {
      result.width = dims.w;
      result.height = dims.h;
      result.meetsMinSize = dims.w >= 250 && dims.h >= 250;
      if (!result.meetsMinSize) result.warnings.push("below_min_250");
    }
  } catch (_) {
    // ignore – we'll just leave dims null
  }

  // Heuristic-only flags surfaced for the UI; real watermark / text-overlay
  // detection requires AI vision. We add a non-blocking note so the UI knows
  // it must run a deeper check before publishing.
  result.warnings.push("watermark_check_pending");
  result.warnings.push("text_overlay_check_pending");
  return result;
}

// Minimal PNG/JPEG/WEBP dimension reader (no deps).
function readImageSize(buf: Uint8Array): { w: number; h: number } | null {
  // PNG
  if (
    buf.length > 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    const view = new DataView(buf.buffer);
    return { w: view.getUint32(16), h: view.getUint32(20) };
  }
  // JPEG
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = (buf[i + 2] << 8) | buf[i + 3];
      // SOF markers
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        return { w, h };
      }
      i += 2 + len;
    }
  }
  // WEBP (VP8X)
  if (
    buf.length > 30 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    // VP8X chunk has dimensions at offset 24 (24-bit little-endian, +1)
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { w, h };
  }
  return null;
}

async function parseStatus(raw: any): Promise<ParsedProduct> {
  const destinationStatuses: DestinationStatus[] = (raw?.destinationStatuses ?? []).map(
    (d: any) => ({
      destination: d.destination ?? "",
      status: d.status ?? "unknown",
      approvedCountries: d.approvedCountries,
      pendingCountries: d.pendingCountries,
      disapprovedCountries: d.disapprovedCountries,
    }),
  );

  const itemLevelIssues: ItemLevelIssue[] = (raw?.itemLevelIssues ?? []).map((i: any) => ({
    code: i.code ?? "",
    servability: i.servability ?? "unaffected",
    resolution: i.resolution ?? "",
    attributeName: i.attributeName,
    destination: i.destination,
    description: i.description ?? "",
    detail: i.detail,
    documentation: i.documentation,
    applicableCountries: i.applicableCountries,
    numberOfItems: i.numberOfItems,
  }));

  const productInapplicability: string[] = (raw?.productInapplicability ?? []).map(
    (x: any) => (typeof x === "string" ? x : x?.reason ?? JSON.stringify(x)),
  );

  const apparelChecks = checkApparel(raw?.product ?? raw);
  const imageLink: string | undefined =
    raw?.product?.imageLink ?? raw?.imageLink ?? undefined;
  const imageChecks = await checkImage(imageLink);

  // Merge derived missing-attribute warnings into itemLevelIssues so the UI
  // sees a single source of truth.
  for (const k of apparelChecks.missing) {
    itemLevelIssues.push({
      code: `derived/missing_${k}`,
      servability: "disapproved",
      resolution: "merchant_action",
      attributeName: k,
      description: `Missing required apparel attribute: ${k}`,
    });
  }
  if (imageChecks.meetsMinSize === false) {
    itemLevelIssues.push({
      code: "derived/image_too_small",
      servability: "disapproved",
      resolution: "merchant_action",
      attributeName: "image_link",
      description: `Image below 250x250 (got ${imageChecks.width}x${imageChecks.height})`,
    });
  }

  return {
    id: String(raw?.productId ?? raw?.product?.offerId ?? raw?.id ?? ""),
    title: raw?.title ?? raw?.product?.title ?? null,
    feedStatus: deriveFeedStatus(destinationStatuses, itemLevelIssues),
    destinationStatuses,
    itemLevelIssues,
    productInapplicability,
    apparelChecks,
    imageChecks,
  };
}

// ───────────────────────── Handler ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const startedAt = Date.now();
  try {
    const saRaw = Deno.env.get("GMC_SERVICE_ACCOUNT_JSON");
    const merchantId = Deno.env.get("GMC_MERCHANT_ID");
    if (!saRaw || !merchantId) {
      console.warn("[gmc-diagnostics] missing GMC_SERVICE_ACCOUNT_JSON or GMC_MERCHANT_ID");
      return json(
        {
          error: "gmc_not_configured",
          message:
            "Add GMC_SERVICE_ACCOUNT_JSON and GMC_MERCHANT_ID secrets to enable Merchant Center diagnostics.",
        },
        503,
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* allow empty */
    }
    const productId: string | undefined = body?.productId;
    const limit: number = Math.min(Math.max(Number(body?.limit) || 50, 1), 250);
    const pageToken: string | undefined = body?.pageToken;

    let sa: ServiceAccount;
    try {
      sa = JSON.parse(saRaw);
    } catch (e) {
      console.error("[gmc-diagnostics] invalid service account JSON", e);
      return json({ error: "invalid_service_account_json" }, 500);
    }

    const accessToken = await getAccessToken(sa);
    const base = `https://merchantapi.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}`;
    const url = new URL(
      productId ? `${base}/productstatuses/${encodeURIComponent(productId)}` : `${base}/productstatuses`,
    );
    if (!productId) {
      url.searchParams.set("maxResults", String(limit));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
    }

    console.log(`[gmc-diagnostics] GET ${url.toString()}`);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(
        `[gmc-diagnostics] Merchant API ${res.status}: ${text.slice(0, 500)}`,
      );
      return json(
        {
          error: "merchant_api_error",
          status: res.status,
          message: text.slice(0, 1000),
        },
        500,
      );
    }

    const data = text ? JSON.parse(text) : {};
    const resources: any[] = productId ? [data] : data?.resources ?? [];
    const products = await Promise.all(resources.map(parseStatus));

    console.log(
      `[gmc-diagnostics] returned ${products.length} products in ${Date.now() - startedAt}ms`,
    );

    return json({
      products,
      nextPageToken: data?.nextPageToken ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[gmc-diagnostics] unhandled error", e);
    return json(
      { error: "internal_error", message: (e as Error).message ?? String(e) },
      500,
    );
  }
});
