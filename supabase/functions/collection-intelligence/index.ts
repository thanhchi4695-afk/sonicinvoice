// AI Collection Automation — Universal Decision Tree Scanner v2
// Loads industry_taxonomy + brand_intelligence to suggest collections for ANY vertical.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  tags: string;
  handle: string;
  status: string;
  image?: { src?: string };
  variants?: Array<{ title?: string; option1?: string; option2?: string }>;
}

interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  products_count?: number;
}

interface TaxonomyDimension {
  vertical: string;
  dimension_name: string;
  dimension_values: string[];
  min_products_to_trigger: number;
  display_order: number;
}

interface BrandRow {
  brand_name: string;
  industry_vertical: string | null;
  collection_structure_type: string | null;
  category_vocabulary: Record<string, string> | null;
  print_story_names: string[] | null;
  crawl_confidence: number | null;
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// 40%-distribution vertical detection.
// Classifies each product by signature keywords across vertical-specific
// product_type / title / tags, then returns any verticals with >=40% share.
// - 0 verticals over threshold => "UNKNOWN"
// - 1 vertical over threshold  => that vertical (e.g. "SWIMWEAR")
// - 2+ verticals over threshold => "MULTI"
const VERTICAL_SIGNATURES: Record<string, string[]> = {
  SWIMWEAR: ["swim", "bikini", "one-piece", "one piece", "rashie", "rash vest", "boardshort", "board short", "trunk", "tankini", "swimsuit", "swimwear", "bather"],
  FOOTWEAR: ["shoe", "sneaker", "boot", "sandal", "heel", "loafer", "mule", "slipper", "thong", "flip flop", "trainer", "pump", "wedge", "espadrille", "clog"],
  CLOTHING: ["dress", "top", "shirt", "blouse", "skirt", "pant", "trouser", "jean", "jacket", "coat", "knit", "jumper", "sweater", "tee", "t-shirt", "hoodie", "cardigan", "blazer", "short", "playsuit", "jumpsuit", "romper"],
  ACCESSORIES: ["bag", "tote", "clutch", "handbag", "backpack", "wallet", "purse", "belt", "hat", "cap", "scarf", "sunglass", "glove", "umbrella"],
  JEWELLERY: ["ring", "necklace", "bracelet", "earring", "pendant", "anklet", "charm", "brooch", "jewellery", "jewelry"],
  LIFESTYLE: ["candle", "diffuser", "perfume", "fragrance", "soap", "lotion", "mug", "homeware", "cushion", "throw", "blanket"],
};

function classifyProductVertical(p: ShopifyProduct): string | null {
  const hay = [p.product_type || "", p.title || "", p.tags || ""].join(" ").toLowerCase();
  if (!hay.trim()) return null;
  let best: string | null = null;
  let bestLen = 0;
  for (const [vert, words] of Object.entries(VERTICAL_SIGNATURES)) {
    for (const w of words) {
      if (hay.includes(w) && w.length > bestLen) {
        best = vert;
        bestLen = w.length;
      }
    }
  }
  return best;
}

function detectVerticalFromProducts(products: ShopifyProduct[]): { vertical: string; distribution: Record<string, number>; classified: number } {
  const counts: Record<string, number> = {};
  let classified = 0;
  for (const p of products) {
    const v = classifyProductVertical(p);
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
    classified++;
  }
  if (classified === 0) return { vertical: "UNKNOWN", distribution: {}, classified: 0 };
  const distribution: Record<string, number> = {};
  const overThreshold: string[] = [];
  for (const [v, n] of Object.entries(counts)) {
    const share = n / classified;
    distribution[v] = Math.round(share * 1000) / 1000;
    if (share >= 0.4) overThreshold.push(v);
  }
  let vertical = "UNKNOWN";
  if (overThreshold.length === 1) vertical = overThreshold[0];
  else if (overThreshold.length >= 2) vertical = "MULTI";
  return { vertical, distribution, classified };
}

async function fetchAllProducts(storeUrl: string, token: string, apiVersion: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let url = `https://${storeUrl}/admin/api/${apiVersion}/products.json?limit=250&status=active&fields=id,title,vendor,product_type,tags,handle,status,image,variants`;
  for (let page = 0; page < 30; page++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) throw new Error(`Shopify products fetch ${res.status}`);
    const data = await res.json();
    all.push(...(data.products ?? []));
    const link = res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    if (!m) break;
    url = m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  return all;
}

async function fetchAllCollections(storeUrl: string, token: string, apiVersion: string): Promise<ShopifyCollection[]> {
  const out: ShopifyCollection[] = [];
  for (const kind of ["custom_collections", "smart_collections"]) {
    let url = `https://${storeUrl}/admin/api/${apiVersion}/${kind}.json?limit=250`;
    for (let page = 0; page < 20; page++) {
      const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
      if (!res.ok) break;
      const data = await res.json();
      const list = data.custom_collections ?? data.smart_collections ?? [];
      out.push(...list);
      const link = res.headers.get("Link") || "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      if (!m) break;
      url = m[1];
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return out;
}

function confidence(type: string, n: number): number {
  if (type === "brand" || type === "type") {
    if (n >= 10) return 0.95;
    if (n >= 5) return 0.8;
    if (n >= 3) return 0.6;
  }
  if (type === "brand_category" || type === "niche") {
    if (n >= 10) return 0.9;
    if (n >= 5) return 0.8;
    if (n >= 3) return 0.6;
  }
  if (type === "print" || type === "dimension") {
    if (n >= 10) return 0.85;
    if (n >= 5) return 0.75;
    if (n >= 3) return 0.6;
  }
  if (type === "archive") return 0.85;
  return 0;
}

interface Suggestion {
  collection_type: string;
  suggested_title: string;
  suggested_handle: string;
  rule_set: unknown;
  product_count: number;
  confidence_score: number;
  sample_product_ids: string[];
  sample_titles: string[];
  sample_images: string[];
}

function productMatchesValue(p: ShopifyProduct, value: string): boolean {
  const v = value.toLowerCase();
  if ((p.title || "").toLowerCase().includes(v)) return true;
  if ((p.tags || "").toLowerCase().split(",").some((t) => t.trim().includes(v))) return true;
  if ((p.product_type || "").toLowerCase().includes(v)) return true;
  if ((p.variants ?? []).some((vt) =>
    (vt.title || "").toLowerCase().includes(v) ||
    (vt.option1 || "").toLowerCase().includes(v) ||
    (vt.option2 || "").toLowerCase().includes(v)
  )) return true;
  return false;
}

function buildSuggestions(
  products: ShopifyProduct[],
  collections: ShopifyCollection[],
  vertical: string,
  dimensions: TaxonomyDimension[],
  brands: BrandRow[],
): Suggestion[] {
  const existingHandles = new Set(collections.map((c) => c.handle.toLowerCase()));
  const existingTitles = new Set(collections.map((c) => c.title.toLowerCase()));
  const out: Suggestion[] = [];

  const addIfNew = (s: Suggestion) => {
    if (existingHandles.has(s.suggested_handle.toLowerCase())) return;
    if (existingTitles.has(s.suggested_title.toLowerCase())) return;
    if (s.confidence_score < 0.5) return;
    out.push(s);
  };

  const sampleFor = (list: ShopifyProduct[]) => ({
    sample_product_ids: list.slice(0, 6).map((p) => String(p.id)),
    sample_titles: list.slice(0, 6).map((p) => p.title),
    sample_images: list.slice(0, 6).map((p) => p.image?.src ?? "").filter(Boolean),
  });

  // 1. Brand collections
  const byVendor = new Map<string, ShopifyProduct[]>();
  for (const p of products) {
    const v = (p.vendor || "").trim();
    if (!v) continue;
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v)!.push(p);
  }
  for (const [vendor, list] of byVendor) {
    if (list.length >= 3) {
      addIfNew({
        collection_type: "brand",
        suggested_title: vendor,
        suggested_handle: slug(vendor),
        rule_set: [{ column: "vendor", relation: "equals", condition: vendor }],
        product_count: list.length,
        confidence_score: confidence("brand", list.length),
        ...sampleFor(list),
      });
    }
    // Brand + product_type
    const byType = new Map<string, ShopifyProduct[]>();
    for (const p of list) {
      const t = (p.product_type || "").trim();
      if (!t) continue;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(p);
    }
    for (const [type, sub] of byType) {
      if (sub.length >= 5) {
        const title = `${vendor} ${type}`;
        addIfNew({
          collection_type: "brand_category",
          suggested_title: title,
          suggested_handle: slug(title),
          rule_set: {
            applied_disjunctively: false,
            rules: [
              { column: "vendor", relation: "equals", condition: vendor },
              { column: "type", relation: "equals", condition: type },
            ],
          },
          product_count: sub.length,
          confidence_score: confidence("brand_category", sub.length),
          ...sampleFor(sub),
        });
      }
    }
  }

  // 2. Generic product_type
  const byType = new Map<string, ShopifyProduct[]>();
  for (const p of products) {
    const t = (p.product_type || "").trim();
    if (!t) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(p);
  }
  for (const [type, list] of byType) {
    if (list.length >= 3) {
      addIfNew({
        collection_type: "type",
        suggested_title: type,
        suggested_handle: slug(type),
        rule_set: [{ column: "type", relation: "equals", condition: type }],
        product_count: list.length,
        confidence_score: confidence("type", list.length),
        ...sampleFor(list),
      });
    }
  }

  // 3. Taxonomy-driven dimensions (vertical-aware)
  for (const dim of dimensions) {
    for (const value of dim.dimension_values) {
      const matched = products.filter((p) => productMatchesValue(p, value));
      if (matched.length >= dim.min_products_to_trigger) {
        const title = `${titleCase(value)} ${titleCase(dim.dimension_name.replace(/_/g, " "))}`.replace(/\s+/g, " ").trim();
        addIfNew({
          collection_type: dim.dimension_name === "print_story" ? "print" : (dim.dimension_name === "function" ? "niche" : "dimension"),
          suggested_title: title,
          suggested_handle: slug(title),
          rule_set: {
            dimension: dim.dimension_name,
            value,
            vertical,
            rules: [
              { column: "tag", relation: "equals", condition: value },
              { column: "title", relation: "contains", condition: value },
            ],
          },
          product_count: matched.length,
          confidence_score: confidence(dim.dimension_name === "print_story" ? "print" : "dimension", matched.length),
          ...sampleFor(matched),
        });
      }
    }
  }

  // 4. Brand print_story names (from crawl)
  for (const b of brands) {
    if (!b.print_story_names) continue;
    const vendorProducts = byVendor.get(b.brand_name) ?? [];
    if (vendorProducts.length === 0) continue;
    for (const story of b.print_story_names.slice(0, 12)) {
      const matched = vendorProducts.filter((p) => productMatchesValue(p, story));
      if (matched.length >= 3) {
        const title = `${b.brand_name} ${story}`;
        addIfNew({
          collection_type: "brand_print",
          suggested_title: title,
          suggested_handle: slug(title),
          rule_set: {
            applied_disjunctively: false,
            rules: [
              { column: "vendor", relation: "equals", condition: b.brand_name },
              { column: "title", relation: "contains", condition: story },
            ],
          },
          product_count: matched.length,
          confidence_score: confidence("print", matched.length),
          ...sampleFor(matched),
        });
      }
    }
  }

  // 4b. Cross-dimension intersections (Mathers pattern)
  // For each product_type with >=10 products, intersect with each taxonomy
  // dimension value. Emits e.g. "Womens Shoes — Heels", "Womens Shoes — Comfort".
  // Threshold: >=5 products in the intersection. Skips trivial dims (gender, size).
  const SKIP_DIMS = new Set(["gender", "size", "cup_size", "gender_use"]);
  for (const [type, typeList] of byType) {
    if (typeList.length < 10) continue;
    for (const dim of dimensions) {
      if (SKIP_DIMS.has(dim.dimension_name)) continue;
      for (const value of dim.dimension_values) {
        const matched = typeList.filter((p) => productMatchesValue(p, value));
        if (matched.length < 5) continue;
        if (matched.length === typeList.length) continue;
        const title = `${titleCase(type)} — ${titleCase(value)}`;
        addIfNew({
          collection_type: "intersection",
          suggested_title: title,
          suggested_handle: slug(`${type}-${value}`),
          rule_set: {
            applied_disjunctively: false,
            parent_type: type,
            dimension: dim.dimension_name,
            value,
            vertical,
            rules: [
              { column: "type", relation: "equals", condition: type },
              { column: "tag", relation: "equals", condition: value },
            ],
          },
          product_count: matched.length,
          confidence_score: confidence("dimension", matched.length),
          ...sampleFor(matched),
        });
      }
    }
  }

  // 5. Archive — empty existing collections
  for (const c of collections) {
    if ((c.products_count ?? -1) === 0) {
      out.push({
        collection_type: "archive",
        suggested_title: c.title,
        suggested_handle: `archive-${slug(c.handle)}`,
        rule_set: { existing_collection_id: c.id, existing_handle: c.handle },
        product_count: 0,
        confidence_score: confidence("archive", 0),
        sample_product_ids: [],
        sample_titles: [],
        sample_images: [],
      });
    }
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const body = await req.json().catch(() => ({}));
    const triggeredBy = (body.triggered_by ?? "manual") as string;
    const verticalOverride = (body.industry_vertical as string | undefined)?.toUpperCase();

    // Internal callers (webhook, cron) authenticate with service-role key + explicit user_id.
    let userId: string | undefined;
    const serviceBearer = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    if (auth === serviceBearer && typeof body.user_id === "string") {
      userId = body.user_id;
    } else if (auth) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: userData } = await userClient.auth.getUser();
      userId = userData.user?.id;
    }
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: scanRow } = await admin
      .from("collection_scans")
      .insert({ user_id: userId, triggered_by: triggeredBy })
      .select("id")
      .single();
    const scanId = scanRow?.id;

    try {
      const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, userId);

      // Fetch products + collections first so we can run distribution-based vertical detection.
      const [products, collections] = await Promise.all([
        fetchAllProducts(storeUrl, accessToken, apiVersion),
        fetchAllCollections(storeUrl, accessToken, apiVersion),
      ]);

      const detection = detectVerticalFromProducts(products);
      const vertical = verticalOverride ?? detection.vertical;

      // Load taxonomy dimensions for this vertical (or all signature verticals if MULTI)
      const verticalsToLoad = vertical === "MULTI"
        ? Object.keys(VERTICAL_SIGNATURES)
        : vertical === "UNKNOWN" ? [] : [vertical];

      const { data: taxRows } = verticalsToLoad.length > 0
        ? await admin.from("industry_taxonomy")
            .select("vertical, dimension_name, dimension_values, min_products_to_trigger, display_order")
            .in("vertical", verticalsToLoad)
            .eq("is_collection_trigger", true)
            .order("display_order")
        : { data: [] as TaxonomyDimension[] };

      const dimensions: TaxonomyDimension[] = (taxRows ?? []).map((r: any) => ({
        vertical: r.vertical,
        dimension_name: r.dimension_name,
        dimension_values: Array.isArray(r.dimension_values) ? r.dimension_values : [],
        min_products_to_trigger: r.min_products_to_trigger ?? 5,
        display_order: r.display_order ?? 0,
      }));

      // Load brand intelligence (for brand-specific print stories)
      const { data: brandRows } = await admin.from("brand_intelligence")
        .select("brand_name, industry_vertical, collection_structure_type, category_vocabulary, print_story_names, crawl_confidence")
        .eq("user_id", userId)
        .gte("crawl_confidence", 0.6);
      const brands = (brandRows ?? []) as BrandRow[];

      const suggestions = buildSuggestions(products, collections, vertical, dimensions, brands);

      let inserted = 0;
      let archives = 0;
      for (const s of suggestions) {
        const { error } = await admin.from("collection_suggestions").insert({
          user_id: userId,
          store_domain: storeUrl,
          ...s,
          status: "pending",
        });
        if (!error) {
          inserted++;
          if (s.collection_type === "archive") archives++;
        }
      }

      if (scanId) {
        await admin.from("collection_scans").update({
          products_scanned: products.length,
          suggestions_created: inserted,
          archive_candidates: archives,
          completed_at: new Date().toISOString(),
          store_domain: storeUrl,
        }).eq("id", scanId);
      }

      return new Response(JSON.stringify({
        success: true,
        scan_id: scanId,
        vertical,
        vertical_detection: {
          detected: detection.vertical,
          override: verticalOverride ?? null,
          classified_products: detection.classified,
          distribution: detection.distribution,
          threshold: 0.4,
        },
        products_scanned: products.length,
        dimensions_loaded: dimensions.length,
        brands_loaded: brands.length,
        suggestions_created: inserted,
        archive_candidates: archives,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (scanId) await admin.from("collection_scans").update({ completed_at: new Date().toISOString(), error: msg }).eq("id", scanId);
      throw e;
    }
  } catch (e) {
    console.error("collection-intelligence error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
