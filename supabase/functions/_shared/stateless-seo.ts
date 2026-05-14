// Stateless SEO helpers — extracted from legacy collection-seo and
// collection-seo-agent functions so seo-collection-engine can serve as
// the single canonical entrypoint for callers that pass raw collection
// objects (no suggestion_id).
//
// Two shapes:
//   - bulkStatelessSeo({ collections, storeName, storeCity, locale, industry })
//     → { results: LegacyBulkResult[] }
//   - singleStatelessSeo({ collection_title, collection_handle, ... })
//     → { success, seo_title, meta_description, body_html, word_count, pushed }

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "./ai-gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface LegacyBulkResult {
  intro_text: string;
  seo_content: string;
  faq: { q: string; a: string }[];
  meta_title: string;
  meta_description: string;
  primary_keyword: string;
  secondary_keywords: string[];
  related_collections: string[];
  confidence_score: number;
  confidence_reason: string;
}

export interface BulkInput {
  collections: any[];
  storeName?: string;
  storeCity?: string;
  locale?: string;
  industry?: string;
  mode?: string;
}

export async function bulkStatelessSeo(input: BulkInput): Promise<{ results: LegacyBulkResult[] }> {
  const { collections, storeName, storeCity, locale, industry } = input;
  const batch = (collections || []).slice(0, 10);
  if (batch.length === 0) return { results: [] };

  const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";

  const systemPrompt = `You are an SEO expert for ${storeName || "a retail store"} in ${storeCity || "Australia"}.
Industry: ${industry || "fashion"}.

TASK: For each Shopify collection, generate SEO-optimized content to make it rank on Google.

OUTPUT PER COLLECTION (JSON):
{
  "intro_text": "2-3 sentence intro paragraph to show ABOVE the product grid. Include primary keyword naturally. HTML with <p> tags.",
  "seo_content": "150-300 word SEO content for BELOW the product grid. Include keyword variations naturally. HTML with <p> and optional <h3> tags. Cover: styles available, occasions, styling ideas.",
  "faq": [{"q": "question", "a": "short answer"}],
  "meta_title": "50-60 chars, include main keyword, readable.",
  "meta_description": "140-160 chars, include keyword, encourage clicks.",
  "primary_keyword": "main keyword",
  "secondary_keywords": ["keyword1", "keyword2", "keyword3"],
  "related_collections": ["related collection 1", "related collection 2", "related collection 3"],
  "confidence_score": 0-100,
  "confidence_reason": "string"
}

SEO RULES:
- ${spelling} spelling throughout
- Primary keyword 2-3 times max across all content
- Include natural variations
- No keyword stuffing
- Clean, modern tone
- No exaggerated claims or fake material claims
- No "premium" or "luxury" unless warranted

META TITLE FORMAT: "{Collection} | {Style Hint} | ${storeName || "Shop"}"
META DESCRIPTION: Start with action verb. Include collection keyword + 1 attribute.

FAQ: Generate 2-3 relevant questions shoppers would ask. Keep answers 1-2 sentences.

RELATED COLLECTIONS: Suggest 3 complementary collection names.

CONFIDENCE:
- High (90-100): Clear collection with products and strong keyword
- Medium (70-89): Identifiable but limited product data
- Low (<70): Vague collection, generic output

RESPOND WITH A JSON ARRAY matching input order.`;

  const userContent = batch.map((c: any, i: number) => {
    const products = (c.products || []).slice(0, 5).map((p: any) => p.title || p).join(", ");
    return `Collection ${i + 1}: title="${c.title || ""}" | type="${c.collection_type || "custom"}" | products="${products}" | tags="${c.tags || ""}" | vendor="${c.vendor || ""}"`;
  }).join("\n");

  const data = await callAI({
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  const raw = getContent(data);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: any = null;
  try { parsed = JSON.parse(clean); } catch {
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
  }

  const fallback = (c: any): LegacyBulkResult => ({
    intro_text: `<p>Explore our ${c?.title || "collection"}.</p>`,
    seo_content: `<p>Shop ${c?.title || "products"} at ${storeName || "our store"}.</p>`,
    faq: [],
    meta_title: (c?.title || "Collection").slice(0, 60),
    meta_description: `Shop ${c?.title || "this collection"} online.`.slice(0, 160),
    primary_keyword: c?.title?.toLowerCase() || "collection",
    secondary_keywords: [],
    related_collections: [],
    confidence_score: 15,
    confidence_reason: "Could not parse AI response",
  });

  if (!Array.isArray(parsed)) {
    if (parsed && typeof parsed === "object" && parsed.intro_text) {
      parsed = [parsed];
    } else {
      parsed = batch.map(fallback);
    }
  }
  while (parsed.length < batch.length) parsed.push(fallback(batch[parsed.length]));

  return { results: parsed.slice(0, batch.length) };
}

export interface SingleInput {
  collection_handle?: string;
  collection_title: string;
  collection_id?: string | number;
  collection_type?: "smart" | "custom";
  rule_column?: string;
  rule_condition?: string;
  store_name?: string;
  store_city?: string;
  user_id: string;
  mode?: string;
}

export interface SingleResult {
  success: boolean;
  pushed: boolean;
  seo_title: string;
  meta_description: string;
  body_html: string;
  word_count: number;
  collection_handle?: string;
}

export async function singleStatelessSeo(input: SingleInput): Promise<SingleResult> {
  const {
    collection_handle, collection_title, collection_id, collection_type,
    rule_column, rule_condition, store_name = "Our Store", store_city = "",
    user_id,
  } = input;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sample products from cache matching the rule
  let sampleProducts: Array<{ title: string }> = [];
  try {
    let q = admin
      .from("product_catalog_cache")
      .select("title, vendor, product_type, tags")
      .eq("user_id", user_id)
      .limit(8);
    if (rule_column === "vendor" && rule_condition) q = q.ilike("vendor", String(rule_condition));
    else if (rule_column === "title" && rule_condition) q = q.ilike("title", `%${rule_condition}%`);
    else if (rule_column === "type" && rule_condition) q = q.ilike("product_type", String(rule_condition));
    const { data } = await q;
    sampleProducts = (data ?? []) as any[];
  } catch { /* table may not exist */ }

  const { data: related } = await admin
    .from("collection_memory")
    .select("title, handle")
    .eq("user_id", user_id)
    .limit(5);

  const sys = `You write SEO copy for ${store_name}${store_city ? ` in ${store_city}` : ""}.
Output strict JSON: { "body_html": string, "seo_title": string, "meta_description": string }.
- body_html: 250-350 words, semantic HTML (<p>, <ul>), 1-2 internal links to related collections using <a href="/collections/{handle}">{title}</a>.
- seo_title: ≤ 65 chars, includes "${store_name}".
- meta_description: ≤ 155 chars, compelling and specific.
Never invent facts not implied by the products listed.`;

  const userMsg = JSON.stringify({
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
        { role: "user", content: userMsg },
      ],
      temperature: 0.5,
    });
    const text = getContent(resp).trim().replace(/^```json\s*|\s*```$/g, "");
    parsed = JSON.parse(text);
  } catch (e) {
    console.warn("stateless single SEO AI failed, using template:", e);
    parsed = {
      body_html: `<p>Discover ${collection_title} at ${store_name}${store_city ? `, ${store_city}` : ""}.</p>`,
      seo_title: `${collection_title} | ${store_name}`,
      meta_description: `Shop ${collection_title} at ${store_name}. Curated styles with fast shipping.`,
    };
  }

  let pushed = false;
  if (collection_id) {
    try {
      const proxyResp = await fetch(`${SUPABASE_URL}/functions/v1/shopify-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "x-user-id": user_id,
        },
        body: JSON.stringify({
          action: "update_collection_seo",
          user_id,
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

  return {
    success: true,
    pushed,
    seo_title: parsed.seo_title ?? "",
    meta_description: parsed.meta_description ?? "",
    body_html: parsed.body_html ?? "",
    word_count: wordCount,
    collection_handle,
  };
}
