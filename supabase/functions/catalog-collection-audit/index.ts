// Catalog Collection Intelligence — finds collection gaps across the full
// Shopify catalog and suggests missing collections via Lovable AI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  store_name?: string;
  store_city?: string;
  mode?: "full" | "brand" | "type";
  filter_vendor?: string;
  filter_type?: string;
  max_products?: number;
  scheduled?: boolean;
}

const SYSTEM = `You are a Shopify collection architect for an Australian swimwear retailer.

You will receive:
1. All existing Shopify collection titles + handles
2. In-stock products grouped by brand with style line analysis

Find GAPS — collection pages that SHOULD exist based on the products but DON'T exist yet.

COLLECTION HIERARCHY:
  TIER 1 — Brand: '{Brand}' — all products by that vendor
  TIER 2 — Brand Story: '{Brand} {StyleLine}' — a seasonal story
  TIER 3 — Category: '{Category}' — global category
  TIER 4 — Brand+Category: '{Brand} {Category}'
  TIER 5 — Feature: special attributes

AUSTRALIAN SWIMWEAR CATEGORIES (use exact names):
  One Pieces, Bikini Tops, Bikini Bottoms, Tankini Tops,
  Rashies & Sunsuits, Kaftans & Cover Ups, Boardshorts,
  Dresses, Tops, Pants, Sunnies, Hats, Accessories, Jewellery,
  Kids Swimwear, Boys Swimwear, Girls Swimwear

FEATURE COLLECTIONS (only if 3+ matching products exist):
  Chlorine Resistant Swimwear, Underwire Swimwear,
  D Cup & Above Swimwear, Plus Size Swimwear,
  Tummy Control Swimwear, UV Protection Swimwear,
  Tie Side Bikini Bottoms, Maternity Swimwear

RULES:
  - Only suggest a collection if at least 3 products would match
  - NEVER suggest a collection whose handle already exists
  - HIGH priority: brands with >10 products that have NO brand collection
  - HIGH priority: style lines with 5+ products and NO story collection
  - MEDIUM: feature collections with 5+ matching products
  - LOW: smaller niche groupings

For each suggestion, include rule_column ('vendor'|'tag'|'title'|'product_type'),
rule_relation ('equals'|'contains'|'starts_with'), rule_condition.
seo_title ≤60 chars, meta_description ≤155 chars. Output via emit_audit tool.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "emit_audit",
    description: "Return collection gap analysis and suggestions.",
    parameters: {
      type: "object",
      properties: {
        gap_analysis: {
          type: "object",
          properties: {
            brands_without_collection: { type: "integer" },
            style_lines_without_collection: { type: "integer" },
            feature_gaps: { type: "array", items: { type: "string" } },
            total_products_uncollected: { type: "integer" },
          },
          required: [
            "brands_without_collection",
            "style_lines_without_collection",
            "feature_gaps",
            "total_products_uncollected",
          ],
          additionalProperties: false,
        },
        suggested_collections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              handle: { type: "string" },
              level: {
                type: "string",
                enum: ["brand", "brand_story", "category", "brand_category", "feature"],
              },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              estimated_products: { type: "integer" },
              rule_column: {
                type: "string",
                enum: ["tag", "vendor", "title", "product_type"],
              },
              rule_relation: {
                type: "string",
                enum: ["equals", "contains", "starts_with"],
              },
              rule_condition: { type: "string" },
              seo_title: { type: "string" },
              meta_description: { type: "string" },
              rationale: { type: "string" },
            },
            required: [
              "title", "handle", "level", "priority", "estimated_products",
              "rule_column", "rule_relation", "rule_condition",
              "seo_title", "meta_description", "rationale",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["gap_analysis", "suggested_collections"],
      additionalProperties: false,
    },
  },
};

function detectLevel(c: { title?: string; rules?: unknown[] | null }): string {
  const title = (c.title || "").toLowerCase();
  const wordCount = title.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1) return "brand";
  if (/(swimwear|cup|control|protection|resistant|maternity|plus size)/.test(title)) return "feature";
  if (wordCount >= 3) return "brand_story";
  return "category";
}

function extractStyleLines(titles: string[], vendor: string): string[] {
  const set = new Set<string>();
  const v = vendor.toLowerCase().trim();
  for (const raw of titles) {
    let t = raw.trim();
    if (v && t.toLowerCase().startsWith(v)) {
      t = t.substring(vendor.length).trim();
    }
    // First 1-2 words = style line candidate
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const candidate = words[0];
    // Skip descriptors
    if (/^(twist|band|mini|micro|high|low|classic|deluxe|premium|active|essential|basic|side|front|back|tie|ring|ruffle|frill|print|stripe|the|and|with)$/i.test(candidate)) continue;
    if (candidate.length < 3) continue;
    set.add(candidate);
  }
  return Array.from(set).slice(0, 30);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const mode = body.mode || "full";
    const maxProducts = Math.min(body.max_products || 800, 2000);

    // ── Get shop_domain
    const { data: connRow } = await admin
      .from("platform_connections")
      .select("shop_domain")
      .eq("user_id", userId)
      .eq("platform", "shopify")
      .eq("is_active", true)
      .maybeSingle();
    const shopDomain = (connRow as { shop_domain?: string } | null)?.shop_domain || "";

    // ── STEP A: fetch existing collections via shopify-proxy ──
    const proxyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-proxy`;
    const callProxy = async (action: string) => {
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify({ action }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.warn(`proxy ${action} failed`, resp.status, j);
        return [];
      }
      return j.collections || [];
    };

    const [customColls, smartColls] = await Promise.all([
      callProxy("get_custom_collections"),
      callProxy("get_smart_collections"),
    ]);
    const allCollections: Array<{
      id: number | string;
      title: string;
      handle: string;
      products_count?: number;
      rules?: unknown[] | null;
      _kind: "custom" | "smart";
    }> = [
      ...customColls.map((c: any) => ({ ...c, _kind: "custom" as const })),
      ...smartColls.map((c: any) => ({ ...c, _kind: "smart" as const })),
    ];

    const existingHandles = new Set(allCollections.map((c) => (c.handle || "").toLowerCase()));
    const existingTitles = new Set(allCollections.map((c) => (c.title || "").toLowerCase()));

    // Sync into collection_memory
    if (shopDomain && allCollections.length > 0) {
      try {
        await admin.from("collection_memory").upsert(
          allCollections.map((c) => ({
            user_id: userId,
            shop_domain: shopDomain,
            collection_title: c.title,
            collection_handle: c.handle,
            shopify_collection_id: String(c.id),
            level: detectLevel(c),
            source_invoice: null,
          })),
          { onConflict: "user_id,shop_domain,collection_handle" },
        );
      } catch (e) {
        console.warn("collection_memory upsert failed", e);
      }
    }

    // ── STEP B: read products from product_catalog_cache ──
    let q = admin
      .from("product_catalog_cache")
      .select("platform_product_id, product_title, vendor, sku, current_qty")
      .eq("user_id", userId)
      .eq("platform", "shopify")
      .gt("current_qty", 0)
      .order("vendor", { ascending: true })
      .limit(maxProducts);

    if (mode === "brand" && body.filter_vendor) {
      q = q.ilike("vendor", body.filter_vendor);
    }

    const { data: products, error: prodErr } = await q;
    if (prodErr) {
      return new Response(JSON.stringify({ error: prodErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    type Prod = {
      platform_product_id: string;
      product_title: string | null;
      vendor: string | null;
      sku: string | null;
      current_qty: number | null;
    };
    const rows = (products ?? []) as Prod[];

    // Group by vendor (dedupe by product_id since cache is per-variant)
    const byVendor = new Map<string, { titles: Set<string>; pids: Set<string> }>();
    for (const r of rows) {
      const v = (r.vendor || "Unknown").trim();
      if (!byVendor.has(v)) byVendor.set(v, { titles: new Set(), pids: new Set() });
      const e = byVendor.get(v)!;
      if (r.product_title) e.titles.add(r.product_title);
      e.pids.add(r.platform_product_id);
    }

    const brandSummary: Record<string, { product_count: number; sample_titles: string[]; style_lines: string[] }> = {};
    for (const [vendor, e] of byVendor.entries()) {
      const titles = Array.from(e.titles);
      brandSummary[vendor] = {
        product_count: e.pids.size,
        sample_titles: titles.slice(0, 12),
        style_lines: extractStyleLines(titles, vendor),
      };
    }

    // ── STEP C: AI gap analysis ──
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Store: ${body.store_name ?? "Splash Swimwear"} (${body.store_city ?? "Darwin"})
Mode: ${mode}${body.filter_vendor ? ` (brand: ${body.filter_vendor})` : ""}${body.filter_type ? ` (type: ${body.filter_type})` : ""}

EXISTING COLLECTIONS (${allCollections.length}):
${JSON.stringify(allCollections.map((c) => ({ title: c.title, handle: c.handle, count: c.products_count ?? 0 })), null, 1)}

PRODUCTS BY BRAND (${Object.keys(brandSummary).length} brands, ${rows.length} variant rows):
${JSON.stringify(brandSummary, null, 1)}

Find collection gaps and emit suggestions via emit_audit. Skip any whose handle is already in EXISTING COLLECTIONS.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "emit_audit" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      const message = aiResp.status === 429
        ? "Rate limit exceeded, please try again shortly."
        : aiResp.status === 402
          ? "AI credits exhausted. Add credits in Settings → Workspace → Usage."
          : `AI gateway error: ${t}`;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = { gap_analysis: {}, suggested_collections: [] };
    try {
      const args = call?.function?.arguments;
      parsed = typeof args === "string" ? JSON.parse(args) : args;
    } catch (e) {
      console.error("Failed to parse tool args", e);
    }

    // Filter out any suggestions whose handle already exists (safety net)
    const suggested = (parsed.suggested_collections || []).filter((s: any) => {
      const h = String(s.handle || "").toLowerCase();
      return h && !existingHandles.has(h) && !existingTitles.has(String(s.title || "").toLowerCase());
    });

    // Empty / stale collections
    const empty = allCollections
      .filter((c) => (c.products_count ?? 0) <= 2)
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        kind: c._kind,
        products_count: c.products_count ?? 0,
        recommendation: (c.products_count ?? 0) === 0 ? "delete" : "keep",
      }));

    return new Response(JSON.stringify({
      gap_analysis: parsed.gap_analysis || {},
      suggested_collections: suggested,
      empty_collections: empty,
      stats: {
        total_existing_collections: allCollections.length,
        total_products_scanned: rows.length,
        unique_products: new Set(rows.map((r) => r.platform_product_id)).size,
        unique_brands: byVendor.size,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("catalog-collection-audit error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
