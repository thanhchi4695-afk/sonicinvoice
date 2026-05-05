// Collection SEO Auto-Generation agent.
// Generates body_html + meta tags for a single collection and pushes to Shopify.
//
// Body shape:
// {
//   collection_handle: string,
//   collection_title: string,
//   collection_id?: string | number,
//   collection_type?: 'smart' | 'custom',
//   rule_column?: string,
//   rule_condition?: string,
//   store_name?: string,
//   store_city?: string,
//   user_id?: string,
// }

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      collection_handle,
      collection_title,
      collection_id,
      collection_type,
      rule_column,
      rule_condition,
      store_name = "Splash Swimwear",
      store_city = "Darwin",
      user_id,
    } = body as Record<string, string | number | undefined>;

    if (!collection_title) {
      return new Response(JSON.stringify({ error: "collection_title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = req.headers.get("Authorization");
    let userId = user_id as string | undefined;
    if (!userId && auth) {
      const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
      });
      const { data } = await sb.auth.getUser();
      userId = data.user?.id;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch sample products from cache matching the rule
    let sampleProducts: Array<{ title: string; vendor?: string }> = [];
    try {
      let q = admin
        .from("product_catalog_cache")
        .select("title, vendor, product_type, tags")
        .eq("user_id", userId)
        .limit(8);
      if (rule_column === "vendor" && rule_condition) {
        q = q.ilike("vendor", String(rule_condition));
      } else if (rule_column === "title" && rule_condition) {
        q = q.ilike("title", `%${rule_condition}%`);
      } else if (rule_column === "type" && rule_condition) {
        q = q.ilike("product_type", String(rule_condition));
      }
      const { data } = await q;
      sampleProducts = (data ?? []) as any[];
    } catch (_) { /* table may not exist */ }

    // Related collections for internal linking
    const { data: related } = await admin
      .from("collection_memory")
      .select("title, handle")
      .eq("user_id", userId)
      .limit(5);

    const sys = `You write SEO copy for ${store_name} in ${store_city}.
Output strict JSON: { "body_html": string, "seo_title": string, "meta_description": string }.
- body_html: 250-350 words, semantic HTML (<p>, <ul>), 1-2 internal links to related collections using <a href="/collections/{handle}">{title}</a>.
- seo_title: ≤ 65 chars, includes "${store_name}".
- meta_description: ≤ 155 chars, compelling and specific.
Never invent facts not implied by the products listed.`;

    const user = JSON.stringify({
      collection_title,
      sample_products: sampleProducts.map((p) => p.title).slice(0, 8),
      related_collections: (related ?? []).map((r: any) => ({ title: r.title, handle: r.handle })),
    });

    let parsed: { body_html?: string; seo_title?: string; meta_description?: string } = {};
    try {
      const resp = await callAI({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.5,
      });
      const text = getContent(resp).trim().replace(/^```json\s*|\s*```$/g, "");
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn("AI SEO failed, using template:", e);
      parsed = {
        body_html: `<p>Discover ${collection_title} at ${store_name}, ${store_city}'s destination for curated swim and resort wear.</p>`,
        seo_title: `${collection_title} | ${store_name}`,
        meta_description: `Shop ${collection_title} at ${store_name}. Curated styles, fast shipping across Australia.`,
      };
    }

    // Push to Shopify if we have an id
    let pushed = false;
    if (collection_id) {
      try {
        const proxyResp = await fetch(`${SUPABASE_URL}/functions/v1/shopify-proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "x-user-id": userId,
          },
          body: JSON.stringify({
            action: "update_collection_seo",
            user_id: userId,
            collection_id,
            collection_type: collection_type ?? "smart",
            body_html: parsed.body_html,
            meta_title: parsed.seo_title,
            meta_description: parsed.meta_description,
          }),
        });
        pushed = proxyResp.ok;
      } catch (e) {
        console.warn("Shopify SEO push failed:", e);
      }
    }

    const wordCount = (parsed.body_html ?? "")
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;

    return new Response(
      JSON.stringify({
        success: true,
        pushed,
        seo_title: parsed.seo_title,
        meta_description: parsed.meta_description,
        body_html: parsed.body_html,
        word_count: wordCount,
        collection_handle,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("collection-seo-agent error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
