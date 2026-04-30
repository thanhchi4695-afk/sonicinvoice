// Edge function: google-merchant-status
//
// Returns aggregate Google Merchant Center feed status counts and a top-errors
// summary for the dashboard. Where GMC credentials are not yet configured we
// fall back to deriving counts from Shopify product metafields so the
// dashboard renders meaningfully on day one.
//
// Response shape:
// {
//   counts: {
//     total, eligible, pending, submitted, submittedWithWarnings, excluded
//   },
//   topErrors: Array<{ code: string, label: string, count: number }>,
//   source: "gmc" | "shopify-fallback",
//   fetchedAt: string
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

interface FeedCounts {
  total: number;
  eligible: number;
  pending: number;
  submitted: number;
  submittedWithWarnings: number;
  excluded: number;
}

interface TopError {
  code: string;
  label: string;
  count: number;
}

const REQUIRED_KEYS = ["gender", "age_group", "color", "category"];

async function shopifyFallback(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ counts: FeedCounts; topErrors: TopError[] } | null> {
  // Look up the user's Shopify token + shop from the project's standard table.
  const { data: cred } = await supabase
    .from("shopify_credentials")
    .select("shop_domain, access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.shop_domain || !cred?.access_token) return null;

  const endpoint = `https://${cred.shop_domain}/admin/api/2024-10/graphql.json`;
  const query = `
    query FeedScan($cursor: String) {
      products(first: 100, after: $cursor, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            metafields(namespace: "google", first: 20) {
              edges { node { key value } }
            }
            variants(first: 50) {
              edges { node { metafield(namespace: "google", key: "size") { value } } }
            }
          }
        }
      }
    }
  `;

  let cursor: string | null = null;
  let total = 0;
  let excluded = 0;
  let eligible = 0;
  const errorTally = new Map<string, number>();

  // Hard cap to keep the function bounded
  for (let page = 0; page < 20; page++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": cred.access_token,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) break;
    const body = await res.json();
    const products = body?.data?.products;
    if (!products) break;
    for (const e of products.edges ?? []) {
      total++;
      const mf = new Map<string, string>();
      for (const m of e.node.metafields?.edges ?? []) {
        if (m.node?.key) mf.set(m.node.key, m.node.value);
      }
      if ((mf.get("feed_excluded") || "").toLowerCase() === "true") {
        excluded++;
        continue;
      }
      const missing: string[] = [];
      for (const k of REQUIRED_KEYS) {
        if (!mf.get(k)) missing.push(k);
      }
      const missingSize = (e.node.variants?.edges ?? []).some(
        (v: any) => !v.node?.metafield?.value,
      );
      if (missingSize) missing.push("size");

      if (missing.length === 0) {
        eligible++;
      } else {
        for (const code of missing) {
          errorTally.set(code, (errorTally.get(code) ?? 0) + 1);
        }
      }
    }
    if (!products.pageInfo?.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }

  const labelMap: Record<string, string> = {
    gender: "Missing gender",
    age_group: "Missing age group",
    color: "Missing color",
    category: "Missing Google product category",
    size: "Missing size on variants",
    gtin: "Missing GTIN",
  };

  const topErrors: TopError[] = [...errorTally.entries()]
    .map(([code, count]) => ({ code, label: labelMap[code] ?? code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // In fallback mode we cannot query GMC, so submitted/pending/warnings are 0.
  const counts: FeedCounts = {
    total,
    eligible,
    pending: 0,
    submitted: 0,
    submittedWithWarnings: 0,
    excluded,
  };
  return { counts, topErrors };
}

// ───────────────────────── Product list (paginated) ─────────────────────────

interface ProductRow {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  status: "eligible" | "disapproved" | "warning" | "not_submitted" | "excluded";
  errors: string[]; // codes: missing_gtin, missing_gender, missing_age_group, missing_color, missing_size, image_too_small
  variantIds: string[];
  productType: string | null;
  shopDomain: string;
}

async function shopifyListProducts(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  cursor: string | null,
  pageSize: number,
  search: string | null,
): Promise<{ rows: ProductRow[]; nextCursor: string | null; hasNext: boolean } | null> {
  const { data: cred } = await supabase
    .from("shopify_credentials")
    .select("shop_domain, access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cred?.shop_domain || !cred?.access_token) return null;

  const endpoint = `https://${cred.shop_domain}/admin/api/2024-10/graphql.json`;
  const queryStr = ["status:active", search ? `title:*${search.replace(/[":]/g, "")}*` : null]
    .filter(Boolean)
    .join(" AND ");

  const query = `
    query ListFeedProducts($cursor: String, $pageSize: Int!, $q: String) {
      products(first: $pageSize, after: $cursor, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            productType
            featuredImage { url }
            metafields(namespace: "google", first: 20) {
              edges { node { key value } }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  barcode
                  metafield(namespace: "google", key: "size") { value }
                  image { width height }
                }
              }
            }
            media(first: 3) {
              edges { node { ... on MediaImage { image { width height } } } }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": cred.access_token,
    },
    body: JSON.stringify({
      query,
      variables: { cursor, pageSize: Math.min(pageSize, 50), q: queryStr || null },
    }),
  });
  if (!res.ok) return { rows: [], nextCursor: null, hasNext: false };
  const body = await res.json();
  const products = body?.data?.products;
  if (!products) return { rows: [], nextCursor: null, hasNext: false };

  const rows: ProductRow[] = (products.edges ?? []).map((e: any) => {
    const node = e.node;
    const mf = new Map<string, string>();
    for (const m of node.metafields?.edges ?? []) {
      if (m.node?.key) mf.set(m.node.key, m.node.value);
    }
    const errors: string[] = [];
    if (!mf.get("gender")) errors.push("missing_gender");
    if (!mf.get("age_group")) errors.push("missing_age_group");
    if (!mf.get("color")) errors.push("missing_color");
    const variants = (node.variants?.edges ?? []).map((v: any) => v.node);
    if (variants.some((v: any) => !v.metafield?.value)) errors.push("missing_size");
    if (variants.some((v: any) => !v.barcode)) errors.push("missing_gtin");
    let smallest: number | null = null;
    for (const m of node.media?.edges ?? []) {
      const img = m.node?.image;
      if (!img?.width || !img?.height) continue;
      const edgePx = Math.min(img.width, img.height);
      if (smallest === null || edgePx < smallest) smallest = edgePx;
    }
    if (smallest !== null && smallest < 250) errors.push("image_too_small");

    const excluded = (mf.get("feed_excluded") || "").toLowerCase() === "true";
    const status: ProductRow["status"] = excluded
      ? "excluded"
      : errors.length === 0
        ? "eligible"
        : "disapproved";

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      imageUrl: node.featuredImage?.url ?? null,
      status,
      errors,
      variantIds: variants.map((v: any) => v.id),
      productType: node.productType ?? null,
      shopDomain: cred.shop_domain,
    };
  });

  return {
    rows,
    nextCursor: products.pageInfo?.endCursor ?? null,
    hasNext: !!products.pageInfo?.hasNextPage,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    let payload: any = {};
    if (req.method === "POST") {
      try { payload = await req.json(); } catch { /* empty body */ }
    }
    const action = payload?.action ?? "summary";

    if (action === "list") {
      const result = await shopifyListProducts(
        supabase,
        userId,
        payload?.cursor ?? null,
        Number(payload?.pageSize) || 50,
        typeof payload?.search === "string" ? payload.search : null,
      );
      if (!result) return json({ rows: [], nextCursor: null, hasNext: false, warning: "Shopify not connected" });
      return json(result);
    }

    // Default: summary counts + top errors
    const fallback = await shopifyFallback(supabase, userId);
    if (!fallback) {
      return json({
        counts: { total: 0, eligible: 0, pending: 0, submitted: 0, submittedWithWarnings: 0, excluded: 0 },
        topErrors: [],
        source: "shopify-fallback",
        fetchedAt: new Date().toISOString(),
        warning: "Shopify not connected",
      });
    }

    return json({
      ...fallback,
      source: "shopify-fallback",
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
