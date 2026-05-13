// AI Collection Automation — Decision Tree Scanner
// Scans Shopify products + collections, produces collection_suggestions rows.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NICHE_TAGS = [
  "tummy control", "d-g", "d-dd", "mastectomy", "chlorine resist",
  "sun protection", "upf 50", "eco", "reduced-impact", "high-waist",
  "tie side bikini bottom", "sustainable",
];
const PRINT_SIGNALS = [
  "Black", "White", "Navy", "Floral", "Animal", "Leopard",
  "Stripe", "Tropical", "Abstract", "Snake", "Zebra",
];

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  tags: string;
  handle: string;
  status: string;
  image?: { src?: string };
  variants?: Array<{ title?: string }>;
}

interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  products_count?: number;
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
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
  if (type === "print") {
    if (n >= 10) return 0.7;
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

function buildSuggestions(products: ShopifyProduct[], collections: ShopifyCollection[]): Suggestion[] {
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

  // Brand
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
    // Brand+Category
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

  // Type
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

  // Niche
  for (const tag of NICHE_TAGS) {
    const lower = tag.toLowerCase();
    const matched = products.filter((p) =>
      (p.tags || "").toLowerCase().split(",").some((t) => t.trim().includes(lower))
    );
    if (matched.length >= 3) {
      const title = tag.replace(/\b\w/g, (c) => c.toUpperCase()) + " Collection";
      addIfNew({
        collection_type: "niche",
        suggested_title: title,
        suggested_handle: slug(title),
        rule_set: [{ column: "tag", relation: "equals", condition: tag }],
        product_count: matched.length,
        confidence_score: confidence("niche", matched.length),
        ...sampleFor(matched),
      });
    }
  }

  // Print / Colour
  for (const word of PRINT_SIGNALS) {
    const lower = word.toLowerCase();
    const matched = products.filter((p) => {
      if ((p.title || "").toLowerCase().includes(lower)) return true;
      return (p.variants ?? []).some((v) => (v.title || "").toLowerCase().includes(lower));
    });
    if (matched.length >= 3) {
      const title = `${word} Swimwear`;
      addIfNew({
        collection_type: "print",
        suggested_title: title,
        suggested_handle: slug(title),
        rule_set: [{ column: "title", relation: "contains", condition: word }],
        product_count: matched.length,
        confidence_score: confidence("print", matched.length),
        ...sampleFor(matched),
      });
    }
  }

  // Archive — empty existing collections
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
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const triggeredBy = (body.triggered_by ?? "manual") as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: scanRow } = await admin
      .from("collection_scans")
      .insert({ user_id: userId, triggered_by: triggeredBy })
      .select("id")
      .single();
    const scanId = scanRow?.id;

    try {
      const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, userId);
      const [products, collections] = await Promise.all([
        fetchAllProducts(storeUrl, accessToken, apiVersion),
        fetchAllCollections(storeUrl, accessToken, apiVersion),
      ]);

      const suggestions = buildSuggestions(products, collections);

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
        products_scanned: products.length,
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
