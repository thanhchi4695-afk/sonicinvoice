// Reconcile Invoice — orchestrator
// Fetches catalog (refreshing if stale), runs the stock-matcher
// logic against cached products, and persists a reconciliation session.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Types ──
interface InvoiceLine {
  sku?: string;
  product_name?: string;
  brand?: string;
  colour?: string;
  size?: string;
  qty: number;
  cost?: number;
  rrp?: number;
  barcode?: string;
}

interface CatalogItem {
  platform: string;
  platform_product_id: string;
  platform_variant_id: string | null;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  variant_title: string | null;
  colour: string | null;
  size: string | null;
  current_qty: number | null;
  current_cost: number | null;
  current_price: number | null;
}

type MatchType =
  | "new"
  | "exact_refill"
  | "new_variant"
  | "new_colour"
  | "exact_refill_conflict"
  | "new_variant_conflict"
  | "new_colour_conflict";

interface ReconciliationLine {
  invoice_sku: string | null;
  invoice_product_name: string | null;
  invoice_colour: string | null;
  invoice_size: string | null;
  invoice_qty: number;
  invoice_cost: number | null;
  invoice_rrp: number | null;
  match_type: MatchType;
  matched_product_id: string | null;
  matched_variant_id: string | null;
  matched_current_qty: number | null;
  matched_current_cost: number | null;
  cost_delta_pct: number | null;
  conflict_reason: string | null;
  user_decision: "pending";
}

const STALE_HOURS = 24;
const MIN_CACHE_ITEMS = 100;
const MAX_CATALOG_WAIT_MS = 3_000;
const PRICE_DELTA_THRESHOLD = 0.1;
const FUZZY_THRESHOLD = 0.8;

// ── String helpers ──
function normaliseSize(size: string): string {
  if (!size) return "";
  let s = size.trim().toLowerCase();
  s = s.replace(/^au\s*/i, "").replace(/^size\s+/i, "").replace(/^sz\s*/i, "");
  s = s.trim();
  const letterMatch = s.match(/^(xxs|xs|s|m|l|xl|xxl|xxxl)$/i);
  if (letterMatch) return letterMatch[1].toUpperCase();
  const num = parseFloat(s);
  if (!isNaN(num) && /^[\d.]+$/.test(s)) return String(num);
  return s.toUpperCase();
}

const COLOUR_SYNONYMS: Record<string, string> = {
  "navy blue": "navy",
  "jet black": "black",
  onyx: "black",
};

function normaliseColour(colour: string): string {
  if (!colour) return "";
  const c = colour.trim().toLowerCase();
  return COLOUR_SYNONYMS[c] ?? c;
}

function coloursEqual(a: string, b: string): boolean {
  return normaliseColour(a) === normaliseColour(b);
}

function sizesEqual(a: string, b: string): boolean {
  return normaliseSize(a) === normaliseSize(b);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const STOPWORDS = new Set(["the", "a", "an", "by", "with", "for", "of", "and", "in"]);
function normaliseName(s: string): string {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter((w) => w && !STOPWORDS.has(w))
    .join(" ").trim();
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true; bMatches[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ── Matching ──
function matchOne(line: InvoiceLine, catalog: CatalogItem[]): ReconciliationLine {
  const base: ReconciliationLine = {
    invoice_sku: line.sku ?? null,
    invoice_product_name: line.product_name ?? null,
    invoice_colour: line.colour ?? null,
    invoice_size: line.size ?? null,
    invoice_qty: line.qty,
    invoice_cost: line.cost ?? null,
    invoice_rrp: line.rrp ?? null,
    match_type: "new",
    matched_product_id: null,
    matched_variant_id: null,
    matched_current_qty: null,
    matched_current_cost: null,
    cost_delta_pct: null,
    conflict_reason: null,
    user_decision: "pending",
  };

  const invSku = (line.sku ?? "").trim().toLowerCase();
  let matched: CatalogItem | null = null;

  // L1 — exact SKU
  if (invSku) {
    matched = catalog.find((c) => (c.sku ?? "").trim().toLowerCase() === invSku) ?? null;
  }
  // L2 — barcode (use invoice sku or barcode field)
  if (!matched && invSku) {
    matched = catalog.find((c) => (c.barcode ?? "").trim().toLowerCase() === invSku) ?? null;
  }
  if (!matched && line.barcode) {
    const bc = line.barcode.trim().toLowerCase();
    matched = catalog.find((c) => (c.barcode ?? "").trim().toLowerCase() === bc) ?? null;
  }
  // L3 — fuzzy SKU
  if (!matched && invSku) {
    let best: { item: CatalogItem; score: number } | null = null;
    for (const c of catalog) {
      const s = (c.sku ?? "").trim().toLowerCase();
      if (!s) continue;
      const score = fuzzyMatch(invSku, s);
      if (score > FUZZY_THRESHOLD && (!best || score > best.score)) {
        best = { item: c, score };
      }
    }
    if (best) matched = best.item;
  }
  // L4 — name + brand
  if (!matched && line.product_name) {
    const invName = normaliseName(line.product_name);
    const invBrand = (line.brand ?? "").trim().toLowerCase();
    let best: { item: CatalogItem; score: number } | null = null;
    for (const c of catalog) {
      const cName = normaliseName(c.product_title ?? "");
      if (!cName) continue;
      const score = jaroWinkler(invName, cName);
      if (score < 0.85) continue;
      if (invBrand) {
        // CatalogItem doesn't carry vendor — skip brand filter when absent
      }
      if (!best || score > best.score) best = { item: c, score };
    }
    if (best) matched = best.item;
  }

  if (!matched) return base;

  base.matched_product_id = matched.platform_product_id;

  const productVariants = catalog.filter(
    (c) => c.platform_product_id === matched!.platform_product_id,
  );

  const invColour = line.colour ?? "";
  const invSize = line.size ?? "";

  const exact = productVariants.find(
    (v) => coloursEqual(v.colour ?? "", invColour) && sizesEqual(v.size ?? "", invSize),
  );

  let baseType: "exact_refill" | "new_variant" | "new_colour" = "new_variant";

  if (exact) {
    baseType = "exact_refill";
    base.matched_variant_id = exact.platform_variant_id;
    base.matched_current_qty = exact.current_qty;
    base.matched_current_cost = exact.current_cost;
  } else {
    const colourExists = productVariants.some((v) => coloursEqual(v.colour ?? "", invColour));
    if (colourExists) {
      baseType = "new_variant";
    } else {
      baseType = "new_colour";
    }
    const sameColour = productVariants.find((v) => coloursEqual(v.colour ?? "", invColour));
    const ref = sameColour ?? productVariants[0] ?? matched;
    base.matched_current_qty = ref.current_qty;
    base.matched_current_cost = ref.current_cost;
  }

  // Price delta
  if (line.cost != null && base.matched_current_cost != null && base.matched_current_cost > 0) {
    const delta = (line.cost - base.matched_current_cost) / base.matched_current_cost;
    base.cost_delta_pct = delta;
    if (Math.abs(delta) > PRICE_DELTA_THRESHOLD) {
      const sign = delta > 0 ? "+" : "";
      base.conflict_reason = `Cost changed from $${base.matched_current_cost.toFixed(2)} to $${line.cost.toFixed(2)} (${sign}${(delta * 100).toFixed(1)}%)`;
      base.match_type = `${baseType}_conflict` as MatchType;
      return base;
    }
  }

  base.match_type = baseType;
  return base;
}

// ── Sync trigger ──
async function triggerSync(
  supabaseUrl: string,
  serviceKey: string,
  fnName: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error(`Sync ${fnName} failed:`, err);
    return false;
  }
}

// ── Handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { user_id, invoice_id, supplier_name, platform, invoice_lines } = body ?? {};

    if (!user_id || !platform || !Array.isArray(invoice_lines)) {
      return new Response(
        JSON.stringify({ error: "Missing user_id, platform, or invoice_lines" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Connections
    const { data: connections } = await supabase
      .from("platform_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true);

    const platforms = platform === "both" ? ["shopify", "lightspeed"] : [platform];
    const activeConns = (connections ?? []).filter((c) => platforms.includes(c.platform));
    const platform_connected = activeConns.length > 0;

    // 2. Catalog freshness
    const { data: cacheRows } = await supabase
      .from("product_catalog_cache")
      .select("*")
      .eq("user_id", user_id)
      .in("platform", platforms);

    let catalog: CatalogItem[] = (cacheRows ?? []) as CatalogItem[];
    let freshness: "live" | "cached" | "refreshed" = catalog.length === 0 ? "live" : "cached";

    const newestCachedAt = (cacheRows ?? []).reduce<number>((max, r: any) => {
      const t = r.cached_at ? new Date(r.cached_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    const ageMs = newestCachedAt ? Date.now() - newestCachedAt : Infinity;
    const stale = ageMs > STALE_HOURS * 3600 * 1000;
    const tooSmall = catalog.length < MIN_CACHE_ITEMS;

    if (platform_connected && (stale || tooSmall)) {
      for (const conn of activeConns) {
        const fnName = conn.platform === "shopify"
          ? "sync-shopify-catalog"
          : "sync-lightspeed-catalog";
        const syncBody: Record<string, unknown> = {
          user_id,
          shop_domain: conn.shop_domain,
          access_token: conn.access_token,
          location_id: conn.location_id,
        };
        await triggerSync(supabaseUrl, serviceKey, fnName, syncBody);
      }
      // Re-fetch catalog
      const { data: refreshed } = await supabase
        .from("product_catalog_cache")
        .select("*")
        .eq("user_id", user_id)
        .in("platform", platforms);
      catalog = (refreshed ?? []) as CatalogItem[];
      freshness = "refreshed";
    }

    // 3. Match
    const lines: ReconciliationLine[] = (invoice_lines as InvoiceLine[]).map((l) =>
      matchOne(l, catalog),
    );

    const summary = {
      total: lines.length,
      new_products: lines.filter((l) => l.match_type === "new").length,
      exact_refills: lines.filter((l) => l.match_type.startsWith("exact_refill")).length,
      new_variants: lines.filter((l) => l.match_type.startsWith("new_variant")).length,
      new_colours: lines.filter((l) => l.match_type.startsWith("new_colour")).length,
      conflicts: lines.filter((l) => l.match_type.endsWith("_conflict")).length,
    };

    // 4. Session record
    const { data: session, error: sessionErr } = await supabase
      .from("reconciliation_sessions")
      .insert({
        user_id,
        invoice_id: invoice_id ?? null,
        supplier_name: supplier_name ?? null,
        platform: platform === "both" ? null : platform,
        total_lines: summary.total,
        new_products: summary.new_products,
        exact_refills: summary.exact_refills,
        new_variants: summary.new_variants,
        conflicts: summary.conflicts,
        status: "pending",
      })
      .select("id")
      .single();

    if (sessionErr || !session) {
      throw new Error(`Failed to create session: ${sessionErr?.message}`);
    }

    // 5. Insert lines (chunked)
    const rowsToInsert = lines.map((l) => ({ ...l, session_id: session.id, user_id }));
    const CHUNK = 500;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const chunk = rowsToInsert.slice(i, i + CHUNK);
      const { error } = await supabase.from("reconciliation_lines").insert(chunk);
      if (error) console.error("Line insert error:", error);
    }

    return new Response(
      JSON.stringify({
        session_id: session.id,
        summary,
        lines,
        catalog_freshness: freshness,
        platform_connected,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("reconcile-invoice error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
