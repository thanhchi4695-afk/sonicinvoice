// supabase/functions/seo-collection-detector/index.ts
// Phase B - Colour, Occasion, Trend & Special Collection Detector (White Fox style)
// Scans the user's product corpus for nested-collection opportunities and writes
// suggestions into public.collection_suggestions.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// ---- Vocabularies ----------------------------------------------------------

const COLOURS = [
  "black","white","ivory","cream","beige","nude","tan","brown","chocolate","camel",
  "grey","gray","charcoal","silver","navy","blue","cobalt","teal","mint","sage","olive",
  "green","emerald","yellow","mustard","gold","orange","coral","rust","red","burgundy",
  "wine","pink","blush","rose","fuchsia","purple","lilac","lavender","print","floral",
];

const OCCASIONS: Record<string, string[]> = {
  festival: ["festival","coachella","rave"],
  resort: ["resort","vacation","holiday","cruise"],
  wedding: ["wedding","bridesmaid","bridal"],
  party: ["party","clubwear","going-out","night-out"],
  workwear: ["work","office","corporate"],
  weekend: ["weekend","casual","everyday"],
  race_day: ["race day","spring racing","carnival"],
};

const TRENDS: Record<string, string[]> = {
  y2k: ["y2k","00s"],
  coastal_grandmother: ["coastal grandmother","coastal-grandma"],
  quiet_luxury: ["quiet luxury","old money"],
  balletcore: ["balletcore","ballet core"],
  westerncore: ["western","cowgirl"],
};

// ---- Helpers ---------------------------------------------------------------

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function detectIn(text: string, vocab: string[]): string[] {
  const t = text.toLowerCase();
  return vocab.filter((w) => t.includes(w));
}

function detectMap(text: string, vocab: Record<string, string[]>): string[] {
  const t = text.toLowerCase();
  const hits: string[] = [];
  for (const [key, words] of Object.entries(vocab)) {
    if (words.some((w) => t.includes(w))) hits.push(key);
  }
  return hits;
}

// ---- Main ------------------------------------------------------------------

interface RunBody {
  user_id?: string;
  brand_id?: string;
  min_products?: number; // threshold for proposing a nested collection
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: RunBody = await req.json().catch(() => ({}));
    const minProducts = body.min_products ?? 3;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user from JWT if not provided
    let userId = body.user_id;
    if (!userId) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) {
        const { data: u } = await supabase.auth.getUser(token);
        userId = u?.user?.id;
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });
    }

    // Pull products (cap to avoid timeouts)
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id,title,product_type,vendor,tags,handle")
      .eq("user_id", userId)
      .limit(2000);

    if (prodErr) throw prodErr;
    const rows = products ?? [];

    // Aggregators: parent (product_type) -> child (colour|occasion|trend) -> count
    type Bucket = { count: number; sample_ids: string[] };
    const buckets: Record<string, Record<string, Bucket>> = {};

    function bump(parent: string, child: string, productId: string) {
      if (!parent || !child) return;
      buckets[parent] ??= {};
      buckets[parent][child] ??= { count: 0, sample_ids: [] };
      const b = buckets[parent][child];
      b.count++;
      if (b.sample_ids.length < 5) b.sample_ids.push(productId);
    }

    for (const p of rows) {
      const parent = (p.product_type || "").trim();
      if (!parent) continue;
      const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "");
      const text = `${p.title ?? ""} ${tags}`;

      for (const c of detectIn(text, COLOURS)) bump(parent, `colour:${c}`, p.id);
      for (const o of detectMap(text, OCCASIONS)) bump(parent, `occasion:${o}`, p.id);
      for (const tr of detectMap(text, TRENDS)) bump(parent, `trend:${tr}`, p.id);
    }

    // Sale + Back-in-stock detection (single-level scan)
    const sale: Record<string, Bucket> = {};
    const backInStock: Record<string, Bucket> = {};
    for (const p of rows) {
      const tags = (Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "")).toLowerCase();
      const parent = (p.product_type || "").trim();
      if (!parent) continue;
      if (tags.includes("sale") || tags.includes("markdown")) {
        sale[parent] ??= { count: 0, sample_ids: [] };
        sale[parent].count++;
        if (sale[parent].sample_ids.length < 5) sale[parent].sample_ids.push(p.id);
      }
      if (tags.includes("back-in-stock") || tags.includes("restocked")) {
        backInStock[parent] ??= { count: 0, sample_ids: [] };
        backInStock[parent].count++;
        if (backInStock[parent].sample_ids.length < 5) backInStock[parent].sample_ids.push(p.id);
      }
    }

    // Build suggestion rows
    const suggestions: any[] = [];

    for (const [parent, kids] of Object.entries(buckets)) {
      const parentSlug = slug(parent);
      for (const [child, info] of Object.entries(kids)) {
        if (info.count < minProducts) continue;
        const [kind, value] = child.split(":");
        const childSlug = slug(value);
        const handle = `${parentSlug}/${childSlug}`;
        const title =
          kind === "colour" ? `${value[0].toUpperCase()}${value.slice(1)} ${parent}` :
          kind === "occasion" ? `${parent} for ${value.replace(/_/g, " ")}` :
          /* trend */          `${value.replace(/_/g, " ")} ${parent}`;

        suggestions.push({
          user_id: userId,
          suggested_title: title,
          suggested_handle: handle,
          shopify_handle: handle,
          collection_type: kind === "colour" ? "dimension" : (kind === "occasion" ? "niche" : "trend"),
          colour_filter: kind === "colour" ? value : null,
          occasion_filter: kind === "occasion" ? value : null,
          trend_signal: kind === "trend" ? value : null,
          product_count: info.count,
          status: "suggested",
          source: "seo-collection-detector",
          metadata: { sample_product_ids: info.sample_ids, parent: parentSlug },
        });
      }
    }

    for (const [parent, info] of Object.entries(sale)) {
      if (info.count < minProducts) continue;
      const parentSlug = slug(parent);
      suggestions.push({
        user_id: userId,
        suggested_title: `${parent} on Sale`,
        suggested_handle: `sale/${parentSlug}`,
        shopify_handle: `sale/${parentSlug}`,
        collection_type: "sale",
        product_count: info.count,
        status: "suggested",
        source: "seo-collection-detector",
        metadata: { sample_product_ids: info.sample_ids },
      });
    }

    for (const [parent, info] of Object.entries(backInStock)) {
      if (info.count < minProducts) continue;
      const parentSlug = slug(parent);
      suggestions.push({
        user_id: userId,
        suggested_title: `${parent} Back in Stock`,
        suggested_handle: `back-in-stock/${parentSlug}`,
        shopify_handle: `back-in-stock/${parentSlug}`,
        collection_type: "back_in_stock",
        product_count: info.count,
        status: "suggested",
        source: "seo-collection-detector",
        metadata: { sample_product_ids: info.sample_ids },
      });
    }

    if (body.dry_run) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, suggestions }), { headers: corsHeaders });
    }

    let inserted = 0;
    if (suggestions.length) {
      const { data, error } = await supabase
        .from("collection_suggestions")
        .upsert(suggestions, { onConflict: "user_id,suggested_handle", ignoreDuplicates: false })
        .select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
    }

    return new Response(JSON.stringify({
      ok: true,
      products_scanned: rows.length,
      suggestions_generated: suggestions.length,
      suggestions_written: inserted,
    }), { headers: corsHeaders });
  } catch (e) {
    console.error("seo-collection-detector error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: corsHeaders });
  }
});
