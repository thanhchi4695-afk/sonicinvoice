// DEPRECATED: replaced by seo-collection-engine (canonical SEO content engine).
// All UI callers (GapsTab, Collections, SonicRank) re-routed 2026-05-14.
// BLOG_TEMPLATE ported to _shared/blog-templates.ts.
// smart_collection_rules ported to _shared/smart-rules.ts.
// Safe to delete after 2026-06-15 (4-week soak window) once production confirms
// no Shopify regressions on Splash + Stomp first weekly health scan.
//
// Universal collection content generator v2.
// - Uses brand_intelligence to mirror brand voice + vocabulary.
// - Selects blog templates based on collection_type (universal across verticals).
// - Outputs smart_collection_rules so collection-publish can build Shopify smart rules.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type BlogType = "sizing" | "care" | "features" | "faq" | "styling" | "occasion" | "trends" | "brand_story" | "materials" | "comparison";

interface GeneratedPayload {
  seo_title: string;
  seo_description: string;
  description_html: string;
  smart_collection_rules?: {
    applied_disjunctively?: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  };
  blogs: Array<{ blog_type: BlogType; title: string; content_html: string }>;
}

interface BrandProfile {
  brand_name: string;
  brand_domain: string | null;
  industry_vertical: string | null;
  category_vocabulary: Record<string, string> | null;
  collection_structure_type: string | null;
  collection_structure_secondary: string | null;
  print_story_names: string[] | null;
  seo_primary_keyword: string | null;
  seo_secondary_keywords: string[] | null;
  brand_tone: string | null;
  brand_tone_sample: string | null;
  blog_topics_used: string[] | null;
  blog_sample_titles: string[] | null;
  blog_topic_distribution: Record<string, number> | null;
  crawl_confidence: number | null;
  manually_verified: boolean;
}

// Blog template selection per collection type — applies universally.
const BLOG_TEMPLATE: Record<string, BlogType[]> = {
  brand: ["brand_story", "styling", "trends"],
  brand_category: ["styling", "features", "sizing"],
  brand_print: ["styling", "trends"],
  type: ["sizing", "care", "features"],
  dimension: ["styling", "occasion"],
  niche: ["features", "faq"],
  print: ["styling", "trends"],
  archive: [],
};

function storeNameFromUrl(storeUrl: string): string {
  const u = storeUrl.toLowerCase();
  if (u.includes("splash")) return "Splash Swimwear Darwin";
  if (u.includes("stomp")) return "Stomp Shoes Darwin";
  return storeUrl.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectBrand(s: Record<string, unknown>, brands: BrandProfile[]): BrandProfile | null {
  if (brands.length === 0) return null;
  const ruleSet = s.rule_set as { vendor?: string; rules?: Array<{ column: string; condition: string }> } | null;
  const vendorFromRules = ruleSet?.rules?.find((r) => r.column === "vendor")?.condition ?? ruleSet?.vendor ?? "";
  const haystack = [
    String(s.suggested_title ?? ""),
    String(vendorFromRules),
    ...((s.sample_titles as string[] | undefined) ?? []),
  ].join(" ").toLowerCase();
  const sorted = [...brands].sort((a, b) => b.brand_name.length - a.brand_name.length);
  for (const b of sorted) {
    if (haystack.includes(b.brand_name.toLowerCase())) return b;
  }
  return null;
}

function brandBlock(b: BrandProfile | null): string {
  if (!b) return "";
  const vocab = b.category_vocabulary && Object.keys(b.category_vocabulary).length > 0
    ? Object.entries(b.category_vocabulary).map(([their, generic]) => `  "${their}" (generic: ${generic})`).join("\n")
    : "  (none extracted)";
  return `
BRAND INTELLIGENCE FOR ${b.brand_name}${b.manually_verified ? " (verified)" : ""} (vertical: ${b.industry_vertical ?? "unknown"}):
- Their category vocabulary (use these EXACT names instead of generic terms):
${vocab}
- Their primary collection structure: ${b.collection_structure_type ?? "unknown"}${b.collection_structure_secondary ? ` (secondary: ${b.collection_structure_secondary})` : ""}
- Their brand tone: ${b.brand_tone ?? "unknown"}
- Sample of their voice: "${(b.brand_tone_sample ?? "").slice(0, 400)}"
- Their print/story names: ${(b.print_story_names ?? []).slice(0, 6).join(", ") || "(none)"}
- Primary SEO keyword: ${b.seo_primary_keyword ?? "(none)"}
- Secondary SEO keywords: ${(b.seo_secondary_keywords ?? []).slice(0, 6).join(", ") || "(none)"}
- Their blog topic types: ${(b.blog_topics_used ?? []).join(", ") || "(none)"}
- Sample titles from their blog: ${(b.blog_sample_titles ?? []).slice(0, 5).join(" | ") || "(none)"}

INSTRUCTION: Mirror ${b.brand_name}'s own voice and vocabulary. Use their exact category names. Reference their brand story and values in the opening paragraph. Use their SEO keywords naturally. Blog titles should follow their own blog structure.
`;
}

function buildPrompt(s: Record<string, unknown>, related: string[], brand: BrandProfile | null, storeName: string, blogTypes: BlogType[]): string {
  const blogSpec = blogTypes.map((t) => `    {"blog_type":"${t}","title":"...","content_html":"400-600 words HTML with <h2>/<p>/<ul>"}`).join(",\n");
  return `COLLECTION CONTEXT:
Type: ${s.collection_type}
Name: ${s.suggested_title}
Products in collection: ${s.product_count}
Sample product titles: ${(s.sample_titles as string[] ?? []).slice(0, 5).join(" | ")}
Existing rule_set hints: ${JSON.stringify(s.rule_set ?? {})}
Related existing collections on this store: ${related.slice(0, 8).join(", ") || "none"}
Store: ${storeName}
${brandBlock(brand)}
OUTPUT JSON ONLY (no prose, no markdown fences) with this exact shape:
{
  "seo_title": "string max 60 chars in form '<Collection> | ${storeName}'",
  "seo_description": "string max 155 chars, keyword-rich",
  "description_html": "180-250 word HTML: <p> opener (2 sentences), <ul> with 3 <li> benefits, <p> with 2 internal anchor links to related collections using href='/collections/<handle>', <p> closing CTA",
  "smart_collection_rules": {
    "applied_disjunctively": false,
    "rules": [ { "column": "vendor|type|tag|title|variant_title", "relation": "equals|contains", "condition": "..." } ]
  },
  "blogs": [
${blogSpec}
  ]
}
Australian English. No exaggerated claims. No fake material claims.`;
}

async function generate(s: Record<string, unknown>, related: string[], brand: BrandProfile | null, storeName: string): Promise<GeneratedPayload> {
  const ct = String(s.collection_type ?? "type");
  const blogTypes = BLOG_TEMPLATE[ct] ?? ["styling", "features"];
  const systemMsg = brand
    ? `You are a senior SEO copywriter for ${storeName}. You write content that mirrors each brand's own voice — for ${brand.brand_name}, channel a ${brand.brand_tone ?? "brand-appropriate"} tone. You output strict JSON only.`
    : `You are a senior SEO copywriter for ${storeName}. You output strict JSON only.`;
  const data = await callAI({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: buildPrompt(s, related, brand, storeName, blogTypes) },
    ],
    temperature: 0.4,
    max_tokens: 4000,
  });
  const raw = getContent(data).trim().replace(/^```json\s*|```$/g, "");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI did not return JSON");
  return JSON.parse(m[0]) as GeneratedPayload;
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

    const body = await req.json();
    const ids: string[] = Array.isArray(body.suggestion_ids)
      ? body.suggestion_ids
      : body.suggestion_id ? [body.suggestion_id] : [];
    if (ids.length === 0) return new Response(JSON.stringify({ error: "suggestion_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Kill switch
    const { data: appSettings } = await admin.from("app_settings").select("brand_intelligence_enabled").maybeSingle();
    const brandIntelEnabled = appSettings?.brand_intelligence_enabled !== false;

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    const { data: related } = await admin
      .from("collection_suggestions")
      .select("suggested_title, store_domain")
      .eq("user_id", userId)
      .in("status", ["published", "approved"])
      .limit(20);
    const relatedTitles = (related ?? []).map((r: any) => r.suggested_title);
    const storeDomain = (related ?? [])[0]?.store_domain ?? "";
    const storeName = storeNameFromUrl(storeDomain);

    let brands: BrandProfile[] = [];
    if (brandIntelEnabled) {
      const { data: brandRows } = await admin
        .from("brand_intelligence")
        .select("brand_name, brand_domain, industry_vertical, category_vocabulary, collection_structure_type, collection_structure_secondary, print_story_names, seo_primary_keyword, seo_secondary_keywords, brand_tone, brand_tone_sample, blog_topics_used, blog_sample_titles, blog_topic_distribution, crawl_confidence, manually_verified")
        .eq("user_id", userId)
        .gte("crawl_confidence", 0.6);
      brands = (brandRows ?? []) as BrandProfile[];
    }

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const { data: s, error } = await admin.from("collection_suggestions").select("*").eq("id", id).eq("user_id", userId).single();
        if (error || !s) throw new Error("suggestion not found");
        if (s.collection_type === "archive") {
          await admin.from("collection_suggestions").update({
            seo_title: s.suggested_title,
            seo_description: "Archive candidate — collection has 0 products.",
            description_html: "<p>This collection currently has no products. Recommend archiving or repairing its rules.</p>",
            status: "content_ready",
          }).eq("id", id);
          results.push({ id, ok: true });
          continue;
        }

        await admin.from("collection_suggestions").update({ status: "content_generating" }).eq("id", id);
        const matchedBrand = detectBrand(s as Record<string, unknown>, brands);
        const out = await generate(s as any, relatedTitles, matchedBrand, storeName);

        await admin.from("collection_suggestions").update({
          seo_title: out.seo_title,
          seo_description: out.seo_description,
          description_html: out.description_html,
          smart_collection_rules: out.smart_collection_rules ?? {},
          status: "content_ready",
          error_message: null,
        }).eq("id", id);

        await admin.from("collection_blogs").delete().eq("suggestion_id", id);
        for (const b of out.blogs ?? []) {
          await admin.from("collection_blogs").insert({
            suggestion_id: id,
            user_id: userId,
            blog_type: b.blog_type,
            title: b.title,
            content_html: b.content_html,
            status: "pending",
          });
        }

        results.push({ id, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("collection_suggestions").update({ status: "error", error_message: msg }).eq("id", id);
        results.push({ id, ok: false, error: msg });
      }
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 12000));
    }

    return new Response(JSON.stringify({ success: true, brand_intel_enabled: brandIntelEnabled, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("collection-content-generator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
