// Edge function: gmc-promotions
//
// Publishes a Google Shopping Promotion to Merchant Center via Content API
// v2.1. Auth uses the same service-account JWT flow as `gmc-diagnostics`.
//
// POST body:
//   {
//     merchantId?: string,         // optional override; falls back to env
//     country?: string,            // default "US"
//     languageCode?: string,       // default "en"
//     promotion: GmcPromotion,     // see type below
//     dryRun?: boolean             // if true, validate + return XML only
//   }
//
// Response (success):
//   { ok: true, mode: "live" | "dry-run", promotionId, xml, response? }
//
// Response (error):
//   { ok: false, error, details? }
//
// Required Lovable Cloud secrets:
//   - GMC_SERVICE_ACCOUNT_JSON
//   - GMC_MERCHANT_ID

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ───────── Types ─────────

type ProductApplicability = "ALL_PRODUCTS" | "SPECIFIC_PRODUCTS";
type RedemptionChannel = "ONLINE" | "IN_STORE";
type OfferType =
  | "PERCENT_OFF"
  | "MONEY_OFF"
  | "FREE_GIFT"
  | "FREE_SHIPPING_STANDARD"
  | "BUY_M_GET_N_MONEY_OFF";

interface GmcPromotion {
  promotion_id: string;
  long_title: string;
  product_applicability: ProductApplicability;
  offer_type: OfferType;
  percentage_discount?: number;       // 1..99
  money_off_amount?: number;          // > 0
  money_off_currency?: string;        // ISO 4217, default USD
  minimum_purchase_amount?: number;
  minimum_purchase_currency?: string;
  promotion_effective_dates: { start: string; end: string }; // ISO 8601 UTC
  redemption_channel: RedemptionChannel[];
  // For SPECIFIC_PRODUCTS / BUY_M_GET_N_MONEY_OFF item linking
  item_ids?: string[];
  // BUY_M_GET_N_MONEY_OFF only
  buy_quantity?: number;
  get_quantity?: number;
  // free gift
  free_gift_description?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

// ───────── OAuth ─────────

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
    throw new Error(`Google OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("No access_token in OAuth response");
  return body.access_token as string;
}

// ───────── Validation ─────────

function validate(p: GmcPromotion): string | null {
  if (!p.promotion_id || !/^[A-Za-z0-9_\-]{1,50}$/.test(p.promotion_id))
    return "promotion_id must be 1-50 chars [A-Za-z0-9_-]";
  if (!p.long_title || p.long_title.length > 150)
    return "long_title required (max 150 chars)";
  if (!p.promotion_effective_dates?.start || !p.promotion_effective_dates?.end)
    return "promotion_effective_dates.start and .end required (ISO 8601 UTC)";
  const start = new Date(p.promotion_effective_dates.start);
  const end = new Date(p.promotion_effective_dates.end);
  if (isNaN(+start) || isNaN(+end) || end <= start)
    return "end_date must be after start_date";
  if (!p.redemption_channel?.length)
    return "redemption_channel must include ONLINE and/or IN_STORE";

  switch (p.offer_type) {
    case "PERCENT_OFF":
      if (p.percentage_discount == null || p.percentage_discount < 1 || p.percentage_discount > 99)
        return "percentage_discount must be 1..99";
      break;
    case "MONEY_OFF":
      if (!p.money_off_amount || p.money_off_amount <= 0)
        return "money_off_amount must be > 0";
      break;
    case "BUY_M_GET_N_MONEY_OFF":
      if (!p.buy_quantity || !p.get_quantity || !p.money_off_amount)
        return "buy_quantity, get_quantity and money_off_amount required";
      if (!p.item_ids?.length)
        return "item_ids required for buy X get Y promotions";
      break;
    case "FREE_GIFT":
      if (!p.free_gift_description) return "free_gift_description required";
      break;
    case "FREE_SHIPPING_STANDARD":
      break;
  }

  if (p.product_applicability === "SPECIFIC_PRODUCTS" && !p.item_ids?.length)
    return "item_ids required when product_applicability = SPECIFIC_PRODUCTS";

  return null;
}

// ───────── XML feed (Content API XML schema) ─────────

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function buildPromotionXml(p: GmcPromotion, country: string, lang: string): string {
  const dates = `${p.promotion_effective_dates.start}/${p.promotion_effective_dates.end}`;
  const lines: string[] = [];
  lines.push(`<promotion>`);
  lines.push(`  <promotion_id>${xmlEscape(p.promotion_id)}</promotion_id>`);
  lines.push(`  <product_applicability>${p.product_applicability}</product_applicability>`);
  lines.push(`  <offer_type>${p.offer_type}</offer_type>`);
  lines.push(`  <long_title>${xmlEscape(p.long_title)}</long_title>`);
  lines.push(`  <promotion_effective_dates>${dates}</promotion_effective_dates>`);
  lines.push(`  <target_country>${country}</target_country>`);
  lines.push(`  <content_language>${lang}</content_language>`);
  for (const ch of p.redemption_channel) lines.push(`  <redemption_channel>${ch}</redemption_channel>`);

  if (p.percentage_discount != null)
    lines.push(`  <percent_off>${p.percentage_discount}</percent_off>`);
  if (p.money_off_amount)
    lines.push(`  <money_off_amount>${p.money_off_amount.toFixed(2)} ${p.money_off_currency ?? "USD"}</money_off_amount>`);
  if (p.minimum_purchase_amount)
    lines.push(`  <minimum_purchase_amount>${p.minimum_purchase_amount.toFixed(2)} ${p.minimum_purchase_currency ?? p.money_off_currency ?? "USD"}</minimum_purchase_amount>`);
  if (p.buy_quantity) lines.push(`  <minimum_purchase_quantity>${p.buy_quantity}</minimum_purchase_quantity>`);
  if (p.get_quantity) lines.push(`  <get_this_quantity_discounted>${p.get_quantity}</get_this_quantity_discounted>`);
  if (p.free_gift_description)
    lines.push(`  <free_gift_description>${xmlEscape(p.free_gift_description)}</free_gift_description>`);
  for (const id of p.item_ids ?? [])
    lines.push(`  <item_id>${xmlEscape(id)}</item_id>`);

  lines.push(`</promotion>`);
  return lines.join("\n");
}

// ───────── Content API JSON shape ─────────

function buildPromotionResource(p: GmcPromotion, country: string, lang: string) {
  const currency = p.money_off_currency ?? "USD";
  const resource: Record<string, unknown> = {
    promotionId: p.promotion_id,
    longTitle: p.long_title,
    productApplicability: p.product_applicability,
    offerType: p.offer_type,
    targetCountry: country,
    contentLanguage: lang,
    redemptionChannel: p.redemption_channel,
    promotionEffectiveTimePeriod: {
      startTime: p.promotion_effective_dates.start,
      endTime: p.promotion_effective_dates.end,
    },
  };
  if (p.percentage_discount != null) resource.percentOff = p.percentage_discount;
  if (p.money_off_amount)
    resource.moneyOffAmount = { value: p.money_off_amount.toFixed(2), currency };
  if (p.minimum_purchase_amount)
    resource.minimumPurchaseAmount = {
      value: p.minimum_purchase_amount.toFixed(2),
      currency: p.minimum_purchase_currency ?? currency,
    };
  if (p.buy_quantity) resource.minimumPurchaseQuantity = p.buy_quantity;
  if (p.get_quantity) resource.getThisQuantityDiscounted = p.get_quantity;
  if (p.free_gift_description) resource.freeGiftDescription = p.free_gift_description;
  if (p.item_ids?.length) resource.itemId = p.item_ids;
  return resource;
}

// ───────── Handler ─────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: {
    merchantId?: string;
    country?: string;
    languageCode?: string;
    promotion?: GmcPromotion;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!body.promotion) return json({ ok: false, error: "promotion required" }, 400);

  const validationError = validate(body.promotion);
  if (validationError) return json({ ok: false, error: validationError }, 400);

  const country = body.country ?? "US";
  const lang = body.languageCode ?? "en";
  const xml = buildPromotionXml(body.promotion, country, lang);

  if (body.dryRun) {
    return json({
      ok: true,
      mode: "dry-run",
      promotionId: body.promotion.promotion_id,
      xml,
    });
  }

  const saRaw = Deno.env.get("GMC_SERVICE_ACCOUNT_JSON");
  const merchantId = body.merchantId ?? Deno.env.get("GMC_MERCHANT_ID");
  if (!saRaw || !merchantId) {
    return json({
      ok: false,
      error: "Missing GMC credentials. Add GMC_SERVICE_ACCOUNT_JSON and GMC_MERCHANT_ID secrets to publish promotions.",
      xml,
    }, 400);
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(saRaw);
  } catch {
    return json({ ok: false, error: "GMC_SERVICE_ACCOUNT_JSON is not valid JSON" }, 500);
  }

  let token: string;
  try {
    token = await getAccessToken(sa);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }

  const resource = buildPromotionResource(body.promotion, country, lang);
  const url = `https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}/promotions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resource),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep as text */ }

  if (!res.ok) {
    return json({
      ok: false,
      error: `Merchant Center rejected promotion (${res.status})`,
      details: parsed,
      xml,
    }, res.status);
  }

  return json({
    ok: true,
    mode: "live",
    promotionId: body.promotion.promotion_id,
    response: parsed,
    xml,
  });
});
