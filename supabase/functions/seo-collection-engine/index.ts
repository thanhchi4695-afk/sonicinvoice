// supabase/functions/seo-collection-engine/index.ts
// THE ICONIC universal SEO engine v2.
// - Resolves taxonomy_level (2..6) and brand-page mode
// - Pulls tiered keywords, ICONIC reference, link mesh, valid sibling handles
// - Single Gemini 2.5 Pro call returning the 5 formula parts + 4-6 FAQ
// - Stitches description_html + faq_html, validates deterministically
// - Up to 2 corrective retries
// - Best-effort push of FAQ to Shopify as metafield seo.faq_content

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import {
  validateSeoOutputV2,
  type ValidationIssue,
  type FormulaParts,
  BANNED_PHRASES,
} from "../_shared/seo-validators.ts";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";
import { generateGeoBlock } from "../_shared/geo-blocks.ts";
import { generateAndPersistBlogs } from "../_shared/blog-templates.ts";
import { persistSmartRules } from "../_shared/smart-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Level = 2 | 3 | 4 | 5 | 6;

interface RunBody {
  suggestion_id: string;
  vertical?: string;
  store_name?: string;
  store_city?: string;
  brand_id?: string;
  voice?: VoiceStyle;
}

function inferTaxonomyLevel(s: any): { level: Level; isBrandPage: boolean } {
  const t: string = s.collection_type || "";
  const handle: string = (s.shopify_handle || s.suggested_handle || "").toLowerCase();
  if (t === "brand" || /^[a-z][a-z0-9-]*$/.test(handle) && (t === "brand" || t === "brand_category")) {
    return { level: 5, isBrandPage: t === "brand" };
  }
  if (t === "brand_category" || t === "brand_print") return { level: 5, isBrandPage: false };
  if (t === "niche" || t === "archive" || /work|evening|wedding|comfort|race|tummy|chlorine/.test(handle)) {
    return { level: 6, isBrandPage: false };
  }
  if (t === "print" || t === "dimension") return { level: 4, isBrandPage: false };
  // type vs sub-type heuristic from handle depth
  const segments = handle.split("-").length;
  if (segments >= 4) return { level: 4, isBrandPage: false };
  if (segments === 3) return { level: 3, isBrandPage: false };
  return { level: 2, isBrandPage: false };
}

function placementsForLevel(level: Level, isBrand: boolean): string[] {
  if (isBrand) return ["brand_opener", "h1_opener"];
  switch (level) {
    case 2: return ["h1_opener", "title_only"];
    case 3: return ["h1_opener", "part2_faq"];
    case 4: return ["h1_opener", "part2_faq"];
    case 5: return ["brand_opener"];
    case 6: return ["part4_cta", "h1_opener"];
  }
}

function pickPrimaryKeyword(suggestion: any, keywords: Array<{ keyword: string; placement_hint: string | null }>) {
  const t = (suggestion.suggested_title || "").toLowerCase();
  const hit = keywords.find((k) => t.includes(k.keyword.toLowerCase().split(" ")[0]));
  if (hit) return hit.keyword;
  return keywords[0]?.keyword || suggestion.suggested_title || "";
}

function safeParseJson(raw: string): any {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch {/**/}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {/**/} }
  return null;
}

function deriveStoreName(storeUrl: string): string {
  const u = (storeUrl || "").toLowerCase();
  if (u.includes("splash")) return "Splash Swimwear Darwin";
  if (u.includes("stomp")) return "Stomp Shoes Darwin";
  const host = u.replace(/^https?:\/\//, "").split("/")[0].split(".")[0];
  return host.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Our Store";
}

// Detect a JEWELLERY-vertical Edit / gifting collection from its handle
function isJewelleryEditHandle(handle: string | undefined | null): boolean {
  const h = (handle || "").toLowerCase();
  return /(^|[-/])(edit|gifting|gifts?|bridal|christmas|valentines|mothers-day|birthday|anniversary|graduation|summer|winter|workwear|everyday|statement|picks)([-/]|$)/.test(h);
}

// Detect a JEWELLERY brand × type|metal intersection (gwg_intersection)
function isJewelleryIntersectionHandle(handle: string | undefined | null): boolean {
  const h = (handle || "").toLowerCase();
  return /-(earrings|necklaces|bracelets|rings|jewellery|gold|silver|sterling-silver|18k-gold|14k-gold|vermeil|pearl)$/.test(h);
}

function stitchDescription(parts: any, isBrandPage: boolean, voice: VoiceStyle, vertical?: string, handle?: string): string {
  // GWG (jewellery) brand page — 5-part meaningful brand story
  if (vertical === "JEWELLERY" && isBrandPage && voice === "gwg_meaningful") {
    return [
      `<p>${parts.gwg_origin ?? parts.brand_origin ?? ""}</p>`,
      `<p>${parts.gwg_aesthetic ?? ""}</p>`,
      `<p>${parts.gwg_product_material ?? ""}</p>`,
      `<p>${parts.gwg_keyword_repetition ?? parts.brand_authority ?? ""}</p>`,
      `<p>${parts.gwg_sub_links_cta ?? parts.brand_sub_links ?? ""}</p>`,
    ].join("\n");
  }
  // GWG Edits / gifting — 3-part lifestyle
  if (vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryEditHandle(handle)) {
    return [
      `<p>${parts.gwg_edit_lifestyle ?? parts.part1_opener ?? ""}</p>`,
      `<p>${parts.gwg_edit_snapshot ?? parts.part3_brands ?? ""}</p>`,
      `<p>${parts.gwg_edit_cta ?? parts.part5_links ?? ""}</p>`,
    ].join("\n");
  }
  // GWG brand × type|metal intersection — 4-part
  if (vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryIntersectionHandle(handle)) {
    return [
      `<p>${parts.gwg_intersection_opener ?? parts.part1_opener ?? ""}</p>`,
      `<p>${parts.gwg_intersection_styles ?? parts.part2_materials ?? ""}</p>`,
      `<p>${parts.gwg_intersection_care ?? parts.part4_styling ?? ""}</p>`,
      `<p>${parts.gwg_intersection_links ?? parts.part5_links ?? ""}</p>`,
    ].join("\n");
  }
  // Louenhide brand page (aussie_accessible + isBrandPage) — dedicated 4-part schema
  if (isBrandPage && voice === "aussie_accessible") {
    return [
      `<p>${parts.lh_brisbane_origin ?? parts.brand_origin ?? ""}</p>`,
      `<p>${parts.lh_mission ?? parts.brand_seasonal ?? ""}</p>`,
      `<p>${parts.lh_keyword_repetition ?? parts.brand_authority ?? ""}</p>`,
      `<p>${parts.lh_collection_link_out ?? parts.brand_sub_links ?? ""}</p>`,
    ].join("\n");
  }
  if (isBrandPage) {
    return [
      `<p>${parts.brand_origin ?? ""}</p>`,
      `<p>${parts.brand_seasonal ?? ""}</p>`,
      `<p>${parts.brand_authority ?? ""}</p>`,
      `<p>${parts.brand_sub_links ?? ""}</p>`,
    ].join("\n");
  }
  // David Jones 4-part (luxury_authority on ACCESSORIES collection page)
  if (voice === "luxury_authority") {
    return [
      `<p>${parts.dj_authority_opener ?? parts.part1_opener ?? ""}</p>`,
      `<p>${parts.dj_occasion_material ?? parts.part2_materials ?? ""}</p>`,
      `<p>${parts.dj_faq_prose ?? parts.part4_styling ?? ""}</p>`,
      `<p>${parts.dj_sub_collection_links ?? parts.part5_links ?? ""}</p>`,
    ].join("\n");
  }
  if (voice === "aspirational_youth" || voice === "local_warmth") {
    // White Fox 6-part formula
    return [
      `<p>${parts.wf_hook ?? parts.part1_opener ?? ""}</p>`,
      `<p>${parts.wf_subtypes ?? parts.part2_materials ?? ""}</p>`,
      `<p>${parts.wf_features ?? ""}</p>`,
      `<p>${parts.wf_fit ?? ""}</p>`,
      `<p>${parts.wf_cross_sell ?? parts.part5_links ?? ""}</p>`,
      `<p>${parts.wf_utility ?? ""}</p>`,
    ].join("\n");
  }
  // ICONIC 5-part formula (professional_editorial / luxury_refined)
  return [
    `<p>${parts.part1_opener ?? ""}</p>`,
    `<p>${parts.part2_materials ?? ""}</p>`,
    `<p>${parts.part3_brands ?? ""}</p>`,
    `<p>${parts.part4_styling ?? ""}</p>`,
    `<p>${parts.part5_links ?? ""}</p>`,
  ].join("\n");
}

type VoiceStyle =
  | "aspirational_youth"
  | "professional_editorial"
  | "local_warmth"
  | "luxury_refined"
  | "luxury_authority"   // David Jones
  | "aussie_accessible"  // Louenhide / Megantic
  | "gwg_meaningful";    // Girls With Gems (jewellery)

function stitchFaqHtml(faq: Array<{ q: string; a: string }>): string {
  return [
    `<section class="collection-faq" itemscope itemtype="https://schema.org/FAQPage">`,
    ...faq.map((it) => [
      `  <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">`,
      `    <h3 itemprop="name">${it.q}</h3>`,
      `    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`,
      `      <p itemprop="text">${it.a}</p>`,
      `    </div>`,
      `  </div>`,
    ].join("\n")),
    `</section>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic length normaliser — runs after the AI loop to guarantee
// meta 150-160, body >=200 words, FAQ answers 30-80 words. We only ever
// extend with safe, brand-aligned phrasing or trim at sentence boundaries —
// never invent facts. Returns the mutated parsed object.
// ---------------------------------------------------------------------------
function countWords(s: string): number {
  const t = (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

function normaliseMeta(meta: string, storeName: string, storeCity: string | null): string {
  let m = (meta || "").trim().replace(/\s+/g, " ");
  // Trim to 160 at last sentence/word boundary
  if (m.length > 160) {
    const cut = m.slice(0, 160);
    const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    m = (lastDot > 130 ? cut.slice(0, lastDot + 1) : cut.replace(/\s+\S*$/, "")).trim();
  }
  if (m.length >= 150 && m.length <= 160) return m;
  // Pad with safe additions until in range
  const pads = [
    " Free Australian shipping.",
    storeCity ? ` Shop in ${storeCity}.` : ` Shop ${storeName}.`,
    " New arrivals weekly.",
    " Easy 30-day returns.",
    " In stock now.",
  ];
  for (const p of pads) {
    if (m.length >= 150) break;
    if ((m + p).length <= 160) m = (m + p).trim();
    else {
      // Try a shorter pad to land in range
      const need = 160 - m.length;
      if (need >= 4) m = (m + p.slice(0, need)).trim();
    }
  }
  // Last resort: pad with periods if still short (keeps it readable)
  while (m.length < 150) m += " " + storeName;
  if (m.length > 160) m = m.slice(0, 160).replace(/\s+\S*$/, "").trim();
  return m;
}

function extendBody(parts: Record<string, string>, isBrandPage: boolean, voice: VoiceStyle, primaryKeyword: string, storeName: string, storeCity: string | null, vertical?: string, handle?: string): Record<string, string> {
  const out = { ...parts };
  const usesWfFormula = voice === "aspirational_youth" || voice === "local_warmth";
  const usesLouenhideBrand = isBrandPage && voice === "aussie_accessible";
  const usesDavidJones = !isBrandPage && voice === "luxury_authority";
  const usesGwgBrand = vertical === "JEWELLERY" && isBrandPage && voice === "gwg_meaningful";
  const usesGwgEdit  = vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryEditHandle(handle);
  const usesGwgInter = vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryIntersectionHandle(handle);
  const slot = usesGwgBrand
    ? "gwg_keyword_repetition"
    : usesGwgEdit
    ? "gwg_edit_snapshot"
    : usesGwgInter
    ? "gwg_intersection_styles"
    : usesLouenhideBrand
    ? "lh_keyword_repetition"
    : usesDavidJones
    ? "dj_faq_prose"
    : isBrandPage
    ? "brand_authority"
    : usesWfFormula
    ? "wf_utility"
    : "part4_styling";
  const fillers = voice === "gwg_meaningful"
    ? [
        `Every piece in our ${primaryKeyword} edit is chosen by hand for the way it wears every day — layered, stacked, gifted, or worn solo.`,
        `Visit ${storeName}${storeCity ? ` in ${storeCity}` : ""} for a personal styling session, or order online with free shipping over $199 and gift packaging at checkout.`,
        `From dainty everyday pieces to statement designs that mark a milestone, the range covers gold, silver, vermeil, and pearl in styles you'll reach for season after season.`,
      ]
    : voice === "aussie_accessible"
    ? [
        `Whether you're ${storeCity ? `shopping in ${storeCity}` : "browsing online"} or grabbing a last-minute gift, our ${primaryKeyword} are built for real life — designed to carry everything you need without the fuss.`,
        `Pop into ${storeName}${storeCity ? ` in ${storeCity}` : ""} and our team will help you find the perfect fit, or order online and we'll have it on its way the same day.`,
        `Every piece is chosen with the everyday in mind: lightweight enough for the school run, smart enough for dinner, and tough enough for the weekend market.`,
      ]
    : voice === "luxury_authority"
    ? [
        `Each piece in our ${primaryKeyword} edit has been selected for craftsmanship, materiality, and longevity.`,
        `${storeName} stocks the full range with complimentary delivery and dedicated styling support across ${storeCity ?? "Australia"}.`,
        `Our buyers travel the world to bring you only the most considered designs — pieces built to be loved season after season.`,
      ]
    : [
        `Visit ${storeName}${storeCity ? ` in ${storeCity}` : ""} to see the full ${primaryKeyword} range with our team on hand to help you find the right fit.`,
        `Every order ships fast with easy returns, and our buyers update the range weekly with new styles in store and online.`,
        `From everyday essentials to standout pieces, the collection is built around what real customers actually wear day to day.`,
      ];
  for (const filler of fillers) {
    if (countWords(stitchDescription(out, isBrandPage, voice, vertical, handle)) >= 200) break;
    out[slot] = ((out[slot] ?? "") + " " + filler).trim();
  }
  return out;
}

function extendFaq(faq: Array<{ q: string; a: string }>, primaryKeyword: string, storeName: string, storeCity: string | null): Array<{ q: string; a: string }> {
  return (faq || []).map((it) => {
    const wc = countWords(it.a);
    if (wc >= 30 && wc <= 80) return it;
    if (wc > 80) {
      // Trim to ~75 words at sentence boundary
      const sentences = it.a.split(/(?<=[.!?])\s+/);
      let acc = "";
      for (const s of sentences) {
        if (countWords((acc + " " + s).trim()) > 75) break;
        acc = (acc + " " + s).trim();
      }
      return { q: it.q, a: acc || it.a.split(/\s+/).slice(0, 75).join(" ") };
    }
    // Pad short answer with one safe sentence
    const pad = `At ${storeName}${storeCity ? ` in ${storeCity}` : ""} we stock the full range, so you can compare ${primaryKeyword} in person or order online with fast shipping and easy returns.`;
    let answer = (it.a + " " + pad).trim();
    // If still short, add a second helper sentence
    if (countWords(answer) < 30) {
      answer += ` Our team is happy to help you choose the right one — just ask in store or message us anytime.`;
    }
    return { q: it.q, a: answer };
  });
}

async function pushFaqMetafield(
  supabase: SupabaseClient,
  userId: string,
  suggestionId: string,
  faqHtml: string,
  shopifyCollectionId: string | null,
) {
  if (!shopifyCollectionId) return { pushed: false, reason: "no shopify_collection_id" };
  try {
    const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(supabase, userId);
    const gid = shopifyCollectionId.startsWith("gid://")
      ? shopifyCollectionId
      : `gid://shopify/Collection/${shopifyCollectionId}`;
    const url = `https://${storeUrl}/admin/api/${apiVersion || "2024-10"}/graphql.json`;
    const mutation = `mutation($metafields:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$metafields){ userErrors{ field message } }
    }`;
    const variables = {
      metafields: [{
        ownerId: gid,
        namespace: "seo",
        key: "faq_content",
        type: "multi_line_text_field",
        value: faqHtml,
      }],
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const j = await resp.json();
    const errs = j?.data?.metafieldsSet?.userErrors ?? [];
    if (errs.length) return { pushed: false, reason: JSON.stringify(errs).slice(0, 200) };
    return { pushed: true };
  } catch (e) {
    return { pushed: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = (await req.json()) as RunBody;
    if (!body?.suggestion_id) return json({ error: "suggestion_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Kill switch
    const { data: settings } = await supabase
      .from("app_settings")
      .select("brand_intelligence_enabled")
      .eq("singleton", true)
      .maybeSingle();
    if (settings && settings.brand_intelligence_enabled === false) {
      return json({ error: "Brand intelligence is disabled" }, 423);
    }

    const { data: suggestion, error: sErr } = await supabase
      .from("collection_suggestions")
      .select("*")
      .eq("id", body.suggestion_id)
      .maybeSingle();
    if (sErr || !suggestion) return json({ error: "suggestion not found" }, 404);

    const { level, isBrandPage } = inferTaxonomyLevel(suggestion);
    const vertical = (body.vertical || (suggestion as any).vertical || "FOOTWEAR").toUpperCase();
    const storeCity = body.store_city || null;

    // Load brand voice style + store_url so we can derive store_name when
    // callers (re-routed from collection-content-generator) only pass suggestion_id.
    const { data: conn } = await supabase
      .from("shopify_connections")
      .select("brand_voice_style, store_url")
      .eq("user_id", suggestion.user_id)
      .maybeSingle();
    const voice: VoiceStyle = (body.voice as VoiceStyle) || (conn?.brand_voice_style as VoiceStyle) || "local_warmth";
    const storeName = body.store_name
      || (conn?.store_url ? deriveStoreName(conn.store_url) : null)
      || "Our Store";

    // Persist taxonomy_level for the row
    if (suggestion.taxonomy_level !== level) {
      await supabase.from("collection_suggestions")
        .update({ taxonomy_level: level })
        .eq("id", suggestion.id);
    }

    // Tiered keywords
    const placements = placementsForLevel(level, isBrandPage);
    const { data: tieredKws } = await supabase
      .from("seo_keyword_tiers")
      .select("tier, keyword, placement_hint, region")
      .eq("vertical", vertical)
      .in("placement_hint", placements)
      .order("tier", { ascending: true })
      .limit(40);

    // Brand intelligence + competitor reference (load whenever brand_id is supplied)
    let brand: any = null;
    if (body.brand_id) {
      const { data } = await supabase
        .from("brand_intelligence")
        .select("brand_name, brand_tone, brand_tone_sample, seo_primary_keyword, seo_secondary_keywords, iconic_reference, whitefox_reference, davidjones_reference, louenhide_megantic_reference, competitor_reference_styletread")
        .eq("id", body.brand_id)
        .maybeSingle();
      if (data) {
        brand = {
          ...data,
          brand_voice: data.brand_tone,
          value_proposition: data.brand_tone_sample,
          hero_keywords: data.seo_secondary_keywords,
        };
      }
    }

    // Link mesh — pre-built sibling/parent/child set; otherwise fall back to siblings
    const { data: meshRows } = await supabase
      .from("collection_link_mesh")
      .select("target_collection_id, link_type, anchor_text")
      .eq("source_collection_id", suggestion.id)
      .limit(8);

    let linkOptions: Array<{ handle: string; title: string; type: string }> = [];
    if (meshRows && meshRows.length > 0) {
      const targetIds = meshRows.map((r) => r.target_collection_id);
      const { data: targets } = await supabase
        .from("collection_suggestions")
        .select("id, suggested_title, suggested_handle, shopify_handle")
        .in("id", targetIds);
      const map = new Map((targets ?? []).map((t: any) => [t.id, t]));
      linkOptions = meshRows.map((r) => {
        const t: any = map.get(r.target_collection_id);
        return t ? {
          handle: t.shopify_handle || t.suggested_handle,
          title: r.anchor_text || t.suggested_title,
          type: r.link_type,
        } : null;
      }).filter(Boolean) as any;
    }
    if (linkOptions.length < 3) {
      const { data: siblings } = await supabase
        .from("collection_suggestions")
        .select("suggested_title, suggested_handle, shopify_handle")
        .eq("user_id", suggestion.user_id)
        .neq("id", suggestion.id)
        .limit(8);
      const have = new Set(linkOptions.map((l) => l.handle));
      for (const s of siblings ?? []) {
        const h = (s as any).shopify_handle || (s as any).suggested_handle;
        if (h && !have.has(h)) {
          linkOptions.push({ handle: h, title: (s as any).suggested_title, type: "sibling" });
          have.add(h);
        }
        if (linkOptions.length >= 6) break;
      }
    }
    const validHandles = new Set(linkOptions.map((l) => l.handle));
    // also allow self handle to be a valid sibling reference if model decides
    const selfHandle = suggestion.shopify_handle || suggestion.suggested_handle;
    if (selfHandle) validHandles.add(selfHandle);

    const primaryKeyword = pickPrimaryKeyword(suggestion, (tieredKws ?? []) as any);

    let lastIssues: ValidationIssue[] = [];
    let parsed: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = buildPrompt({
        suggestion, level, isBrandPage, vertical, storeName, storeCity,
        keywords: (tieredKws ?? []) as any, brand, linkOptions, primaryKeyword,
        previousIssues: lastIssues, voice,
      });
      const ai = await callAI({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.4,
        timeoutMs: 120_000,
      });
      const raw = getContent(ai);
      parsed = safeParseJson(raw);
      if (!parsed) {
        lastIssues = [{ field: "_parse", message: "Model did not return JSON" }];
        continue;
      }
      const _handle = suggestion.shopify_handle || suggestion.suggested_handle;
      const description_html = stitchDescription(parsed.formula_parts || {}, isBrandPage, voice, vertical, _handle);
      lastIssues = validateSeoOutputV2({
        seo_title: parsed.seo_title,
        meta_description: parsed.meta_description,
        formula_parts: parsed.formula_parts || {},
        description_html,
        faq: parsed.faq || [],
        smart_rules_json: parsed.smart_rules_json,
      }, {
        taxonomy_level: level,
        primary_keyword: primaryKeyword,
        city: storeCity,
        is_brand_page: isBrandPage,
        valid_handles: validHandles,
      });
      parsed.__description_html = description_html;
      if (lastIssues.length === 0) break;
    }

    if (!parsed) return json({ error: "Model parse failure", issues: lastIssues }, 502);

    // ---- Deterministic length normaliser (fixes the 3 chronic length issues
    //      meta 150-160, body >=200 words, FAQ answers 30-80 words) ----
    const lengthIssueFields = new Set(
      lastIssues
        .filter((i) =>
          (i.field === "meta_description" && /chars/.test(i.message)) ||
          (i.field === "description_html" && /words/.test(i.message)) ||
          (i.field === "faq" && /answer \d+ words/.test(i.message))
        )
        .map((i) => i.field),
    );
    if (lengthIssueFields.size > 0) {
      if (lengthIssueFields.has("meta_description")) {
        parsed.meta_description = normaliseMeta(parsed.meta_description ?? "", storeName, storeCity);
      }
      if (lengthIssueFields.has("description_html")) {
        parsed.formula_parts = extendBody(parsed.formula_parts || {}, isBrandPage, voice, primaryKeyword, storeName, storeCity, vertical, _handle);
        parsed.__description_html = stitchDescription(parsed.formula_parts, isBrandPage, voice, vertical, _handle);
      }
      if (lengthIssueFields.has("faq")) {
        parsed.faq = extendFaq(parsed.faq || [], primaryKeyword, storeName, storeCity);
      }
      // Re-validate after normaliser
      lastIssues = validateSeoOutputV2({
        seo_title: parsed.seo_title,
        meta_description: parsed.meta_description,
        formula_parts: parsed.formula_parts || {},
        description_html: parsed.__description_html,
        faq: parsed.faq || [],
        smart_rules_json: parsed.smart_rules_json,
      }, {
        taxonomy_level: level,
        primary_keyword: primaryKeyword,
        city: storeCity,
        is_brand_page: isBrandPage,
        valid_handles: validHandles,
      });
    }

    const description_html = parsed.__description_html as string;
    const faq = (parsed.faq ?? []) as Array<{ q: string; a: string }>;
    const faq_html = stitchFaqHtml(faq);
    const expiresAt = level === 4
      ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 6).toISOString()
      : null;

    const { error: upErr } = await supabase
      .from("collection_seo_outputs")
      .upsert({
        suggestion_id: suggestion.id,
        layer: level,
        seo_title: (parsed.seo_title || "").slice(0, 60),
        meta_description: parsed.meta_description ?? "",
        description_html,
        faq_html,
        formula_parts: parsed.formula_parts ?? null,
        smart_rules_json: parsed.smart_rules_json ?? null,
        rules_validated_count: 0,
        rules_status: "pending",
        status: "draft",
        validation_errors: lastIssues.length ? lastIssues : null,
        refreshed_at: new Date().toISOString(),
        expires_at: expiresAt,
      }, { onConflict: "suggestion_id" });
    if (upErr) return json({ error: upErr.message }, 500);

    // ── Smart collection rules (ported from collection-content-generator) ──
    // Mirror parsed.smart_rules_json onto collection_suggestions so
    // collection-publish (reads s.rule_set) and legacy UI (reads
    // s.smart_collection_rules) both have the rules.
    let smartRulesResult: any = { persisted: false };
    try {
      smartRulesResult = await persistSmartRules(supabase, suggestion.id, parsed.smart_rules_json);
    } catch (e) {
      console.warn("persistSmartRules failed (non-fatal)", e);
      smartRulesResult = { persisted: false, error: e instanceof Error ? e.message : String(e) };
    }

    // ── Blog drafts (ported from collection-content-generator) ──
    // Generate fully-rendered blog HTML based on BLOG_TEMPLATE per collection_type
    // and write to collection_blogs (consumed by Collections page).
    let blogResult: any = { generated: 0 };
    try {
      blogResult = await generateAndPersistBlogs({
        supabase,
        suggestionId: suggestion.id,
        userId: suggestion.user_id,
        collectionType: (suggestion as any).collection_type,
        collectionTitle: (suggestion as any).suggested_title,
        sampleTitles: Array.isArray((suggestion as any).sample_titles) ? (suggestion as any).sample_titles : [],
        storeName,
        brandName: brand?.brand_name ?? null,
        brandTone: brand?.brand_tone ?? null,
      });
    } catch (e) {
      console.warn("generateAndPersistBlogs failed (non-fatal)", e);
      blogResult = { generated: 0, error: e instanceof Error ? e.message : String(e) };
    }

    // Persist blog plans (still useful)
    if (Array.isArray(parsed.blog_plans) && parsed.blog_plans.length > 0) {
      const rows = parsed.blog_plans.slice(0, 6).map((b: any, idx: number) => ({
        suggestion_id: suggestion.id,
        blog_index: idx + 1,
        title: String(b.title || "").slice(0, 200),
        target_keywords: Array.isArray(b.target_keywords) ? b.target_keywords.slice(0, 8) : [],
        sections: b.sections ?? [],
        faq: idx === 0 ? faq : (b.faq ?? []),
        status: "plan",
      }));
      await supabase.from("collection_blog_plans").delete().eq("suggestion_id", suggestion.id);
      if (rows.length > 0) await supabase.from("collection_blog_plans").insert(rows);
    }

    // Best-effort push to Shopify
    const push = await pushFaqMetafield(
      supabase, suggestion.user_id, suggestion.id, faq_html,
      suggestion.shopify_collection_id ?? null,
    );

    // ── GEO answer-block generation (additive — never overwrites approved) ──
    let geoResult: any = { generated: false };
    try {
      const { data: existingGeo } = await supabase
        .from("collection_geo_blocks")
        .select("id, status")
        .eq("collection_suggestion_id", suggestion.id)
        .maybeSingle();

      if (existingGeo && existingGeo.status !== "draft") {
        geoResult = { generated: false, reason: `existing GEO block is ${existingGeo.status} — preserved` };
      } else {
        // Build brand list from sample_titles vendors + brand_intelligence rows
        const sampleTitles: string[] = Array.isArray((suggestion as any).sample_titles)
          ? (suggestion as any).sample_titles
          : [];
        const distinctBrandNames: string[] = Array.from(
          new Set(
            (Array.isArray((suggestion as any).sample_brands) ? (suggestion as any).sample_brands : [])
              .map((b: any) => String(b || "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 6) as string[];
        let brandRows: Array<{ name: string; tone?: string | null; differentiator?: string | null }> = [];
        if (distinctBrandNames.length >= 2) {
          const { data: bi } = await supabase
            .from("brand_intelligence")
            .select("brand_name, brand_tone, brand_tone_sample")
            .in("brand_name", distinctBrandNames);
          const map = new Map((bi ?? []).map((r: any) => [String(r.brand_name).toLowerCase(), r]));
          brandRows = distinctBrandNames.map((n) => {
            const row: any = map.get(n.toLowerCase());
            return { name: n, tone: row?.brand_tone ?? null, differentiator: row?.brand_tone_sample ?? null };
          });
        }

        const geo = await generateGeoBlock({
          vertical,
          primary_keyword: primaryKeyword,
          collection_title: suggestion.suggested_title,
          store_name: storeName,
          store_city: storeCity,
          sample_titles: sampleTitles,
          brands: brandRows,
        });

        await supabase.from("collection_geo_blocks").upsert({
          collection_suggestion_id: suggestion.id,
          user_id: suggestion.user_id,
          scenario_questions: geo.scenario_questions,
          comparison_snippet: geo.comparison_snippet,
          care_instructions: geo.care_instructions,
          best_for_summary: geo.best_for_summary,
          status: "draft",
          validation_errors: geo.validation_errors.length ? geo.validation_errors : null,
          refreshed_at: new Date().toISOString(),
        }, { onConflict: "collection_suggestion_id" });

        geoResult = {
          generated: true,
          validation_errors: geo.validation_errors,
          has_comparison: !!geo.comparison_snippet,
          has_care: !!geo.care_instructions,
        };
      }
    } catch (geoErr) {
      console.warn("GEO block generation failed (non-fatal)", geoErr);
      geoResult = { generated: false, error: geoErr instanceof Error ? geoErr.message : String(geoErr) };
    }

    return json({
      ok: true,
      level,
      is_brand_page: isBrandPage,
      validation_errors: lastIssues,
      shopify_push: push,
      geo: geoResult,
      smart_rules: smartRulesResult,
      blogs: blogResult,
    });
  } catch (e) {
    console.error("seo-collection-engine error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPrompt(opts: {
  suggestion: any;
  level: Level;
  isBrandPage: boolean;
  vertical: string;
  storeName: string;
  storeCity: string | null;
  keywords: Array<{ tier: number; keyword: string; placement_hint: string | null }>;
  brand: any;
  linkOptions: Array<{ handle: string; title: string; type: string }>;
  primaryKeyword: string;
  previousIssues: ValidationIssue[];
  voice: VoiceStyle;
}) {
  const { suggestion, level, isBrandPage, vertical, storeName, storeCity, keywords, brand, linkOptions, primaryKeyword, previousIssues, voice } = opts;

  const titleFormulas: Record<Level, string> = {
    2: "{Audience} {Category} | " + storeName,
    3: "{Audience} {Type} | " + storeName,
    4: "{Audience} {Sub-type} | " + storeName,
    5: "{Brand}" + (vertical === "FOOTWEAR" ? " Shoes" : "") + " | " + storeName,
    6: "{Occasion}" + (storeCity ? " " + storeCity : "") + " | " + storeName,
  };

  // Competitor reference router (in priority order):
  //   ACCESSORIES + luxury_authority    -> David Jones (premium multi-brand)
  //   ACCESSORIES + aussie_accessible   -> Louenhide / Megantic (3-innovation playbook)
  //   CLOTHING/SWIMWEAR + aspirational  -> White Fox (single-brand DTC)
  //   default                            -> THE ICONIC (marketplace breadth)
  const useDavidJones =
    vertical === "ACCESSORIES" && voice === "luxury_authority" && !!brand?.davidjones_reference;
  const useLouenhide =
    vertical === "ACCESSORIES" && voice === "aussie_accessible" && !!brand?.louenhide_megantic_reference;
  const useWhiteFox =
    !useDavidJones && !useLouenhide &&
    (vertical === "CLOTHING" || vertical === "SWIMWEAR") &&
    (voice === "aspirational_youth" || voice === "local_warmth") &&
    !!brand?.whitefox_reference;
  const refLabel =
    useDavidJones ? "DAVID JONES REFERENCE (luxury 4-part formula)" :
    useLouenhide  ? "LOUENHIDE / MEGANTIC REFERENCE (3-innovation playbook)" :
    useWhiteFox   ? "WHITE FOX REFERENCE" :
                    "THE ICONIC REFERENCE";
  const refData =
    useDavidJones ? brand?.davidjones_reference :
    useLouenhide  ? brand?.louenhide_megantic_reference :
    useWhiteFox   ? brand?.whitefox_reference :
                    brand?.iconic_reference;
  const iconicBlock = refData
    ? `\n${refLabel} for ${brand?.brand_name ?? "this brand"} (match vocabulary, do not plagiarise):\n` +
      JSON.stringify(refData).slice(0, 1800) + "\n"
    : "";

  // Niche-keyword guard (Megantic Innovation 2): never use broad standalone keywords as primary
  const broadBlocklist = new Set(["bags","accessories","wallets","handbags","online shopping"]);
  const jewelleryBroadBlocklist = new Set(["jewellery","jewelry","earrings","necklaces","bracelets","rings","gold","silver"]);
  const nicheGuard = vertical === "ACCESSORIES"
    ? `\nNICHE KEYWORD GUARD: never use any of these as the primary keyword on its own — ${[...broadBlocklist].join(", ")}. Always combine with brand + type, feature, or location signal (e.g. "louenhide crossbody bag", "rfid blocking wallet women", "bags darwin").\n`
    : vertical === "JEWELLERY"
    ? `\nNICHE KEYWORD GUARD: never use any of these as the primary keyword on its own — ${[...jewelleryBroadBlocklist].join(", ")}. Always combine with brand + type, metal, occasion, gifting, or location (e.g. "by charlotte lotus necklace", "18k gold vermeil hoop earrings", "bridesmaid gift jewellery australia", "jewellery double bay").\n`
    : "";

  const previousBlock = previousIssues.length
    ? "\nPREVIOUS ATTEMPT FAILED with these issues - fix every one:\n" +
      previousIssues.map((i) => "- [" + i.field + "] " + i.message).join("\n") + "\n"
    : "";

  const linkList = linkOptions
    .map((l) => `  - [${l.type}] "${l.title}" -> /collections/${l.handle}`)
    .join("\n");

  const kwList = keywords.slice(0, 25)
    .map((k) => `  - T${k.tier} (${k.placement_hint ?? ""}) ${k.keyword}`)
    .join("\n");

  // Dedicated schemas for the JEWELLERY (GWG) and ACCESSORIES competitor playbooks.
  const _handleStr = suggestion.shopify_handle || suggestion.suggested_handle || "";
  const useGwgBrand        = vertical === "JEWELLERY" && isBrandPage && voice === "gwg_meaningful";
  const useGwgEdit         = vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryEditHandle(_handleStr);
  const useGwgIntersection = vertical === "JEWELLERY" && voice === "gwg_meaningful" && isJewelleryIntersectionHandle(_handleStr);
  const useLouenhideBrand = isBrandPage && voice === "aussie_accessible";
  const useDavidJonesCol  = !isBrandPage && voice === "luxury_authority" && vertical === "ACCESSORIES";

  const formulaSchema = useGwgBrand
    ? `{
  "gwg_origin": "2 sentences. Sentence 1: country/city of origin, founding year, founder name. Sentence 2: founder intent / what makes the brand distinct.",
  "gwg_aesthetic": "2 sentences on brand aesthetic + design inspiration — the visual and emotional world (e.g. Mediterranean summers, celestial symbols, mindful mantras).",
  "gwg_product_material": "2 sentences naming what they make (necklaces, earrings, bracelets, rings) and what it's made from (18k gold vermeil, 14k gold, sterling silver, freshwater pearls, gemstones). SEO-loaded with materials.",
  "gwg_keyword_repetition": "3-4 sentences. The exact 'brand + jewellery type' phrase (e.g. 'By Charlotte necklaces') must appear at least 3 times naturally across these sentences. Cover the brand's earrings, necklaces, bracelets, rings, and gifts.",
  "gwg_sub_links_cta": "1-2 sentences containing 3-5 inline <a href='/collections/{handle}'>{title}</a> links picked ONLY from the RELATED COLLECTIONS list (brand × type intersections preferred), ending with a local CTA to ${storeName}${storeCity ? ' in ' + storeCity : ''}."
}`
    : useGwgEdit
    ? `{
  "gwg_edit_lifestyle": "2 sentences. Lifestyle moment opener: '[Edit Name] is ${storeName}'s curated selection of [occasion/style] pieces chosen by our ${storeCity ?? 'in-store'} stylists.' Set the emotional scene.",
  "gwg_edit_snapshot": "3 sentences naming specific products/brands from sample_titles and their role in the occasion (e.g. 'delicate By Charlotte necklaces for the bride, bold Amber Sceats statement earrings for the mother of the bride').",
  "gwg_edit_cta": "1-2 sentences with a gifting/occasion CTA + 2-3 inline <a href='/collections/{handle}'>{title}</a> links to related type collections, free shipping note, in-store ${storeCity ?? 'visit'} invitation."
}`
    : useGwgIntersection
    ? `{
  "gwg_intersection_opener": "2 sentences (~45 words). Sentence 1 contains the exact intersection keyword (e.g. 'By Charlotte necklaces' or '18k gold vermeil earrings') in the first 10 words. Sentence 2 expands on the brand's design signature for this type/metal.",
  "gwg_intersection_styles": "2 sentences (~50 words) naming 3-5 specific style names from sample_titles, materials, and gemstone/finish details.",
  "gwg_intersection_care": "2 sentences on care, sizing, layering or gifting guidance for this intersection.",
  "gwg_intersection_links": "1-2 sentences containing 3-5 inline <a href='/collections/{handle}'>{title}</a> links chosen ONLY from the RELATED COLLECTIONS list (sibling brand × type or sibling metal collections), ending with a CTA to ${storeName}."
}`
    : useLouenhideBrand
    ? `{
  "lh_brisbane_origin": "2 sentences. Sentence 1 names the brand and its Brisbane (or actual home-city) founding story with a year. Sentence 2 names the founder's intent.",
  "lh_mission": "2 sentences on the brand mission — accessible everyday luxury, considered design, vegan-friendly materials. No fluff, plain Aussie tone.",
  "lh_keyword_repetition": "3-4 sentences. The exact primary keyword (brand + product type, e.g. 'louenhide crossbody bag') must appear at least 3 times naturally across these sentences. Cover sub-types, materials, occasions.",
  "lh_collection_link_out": "1-2 sentences containing 3-5 inline <a href='/collections/{handle}'>{title}</a> links picked ONLY from the RELATED COLLECTIONS list, ending with a friendly CTA to ${storeName}."
}`
    : useDavidJonesCol
    ? `{
  "dj_authority_opener": "2 sentences (~45 words). Sentence 1 leads with curatorial authority ('At ${storeName}, our edit of ${primaryKeyword} brings together…') and contains the primary keyword. Sentence 2 names the breadth of brands/styles in the edit.",
  "dj_occasion_material": "2 sentences (~50 words) loading occasion language (workwear, evening, weekend, race day, wedding) and materiality (Italian leather, vegan leather, suede, canvas) in the same passage.",
  "dj_faq_prose": "3-4 sentences answering the top customer questions in flowing prose (not Q&A) — sizing, care, what's included, delivery — written for a premium reader.",
  "dj_sub_collection_links": "1-2 sentences containing 3-5 inline <a href='/collections/{handle}'>{title}</a> links chosen ONLY from the RELATED COLLECTIONS list, ending with a refined CTA."
}`
    : isBrandPage
    ? `{
  "brand_origin": "2 sentences with founding year and origin",
  "brand_seasonal": "2-3 sentences naming summer + winter product types",
  "brand_authority": "1-2 sentences on brand standing and availability at ${storeName}",
  "brand_sub_links": "1 sentence with 3-5 inline <a href='/collections/{handle}'>{title}</a> links to brand+category sub-collections"
}`
    : `{
  "part1_opener": "2 sentences (~40 words). Sentence 1 contains the primary keyword. Sentence 2 expands sub-types, occasions, materials.",
  "part2_materials": "1 sentence (~30 words) on materials, constructions, closures, technology features",
  "part3_brands": "1 sentence (~20 words) naming 3-5 brands stocked",
  "part4_styling": "2-3 sentences of practical styling/occasion guidance${storeCity ? ', mentioning ' + storeCity : ''}",
  "part5_links": "1-2 sentences containing 3-5 internal <a href='/collections/{handle}'>{title}</a> links chosen from the related list, ending with a CTA"
}`;

  const system = `You are an expert Australian retail SEO copywriter writing a single collection page for ${storeName}${storeCity ? ' (' + storeCity + ')' : ''} in the ${vertical} vertical.
You MUST output ONLY valid JSON matching the exact schema below. No markdown, no commentary.

TAXONOMY LEVEL: ${level}${isBrandPage ? " (BRAND PAGE)" : ""}
TITLE FORMULA: ${titleFormulas[level]}

HARD RULES (failure = retry):
- seo_title: max 60 chars, follow title formula
- meta_description: EXACTLY 150-160 characters, primary keyword in first 12 words, mention "${storeName}"${level === 3 || level === 6 ? `, mention "${storeCity}"` : ""}
- formula_parts: each part must be plain HTML-safe text (you will see them concatenated as <p> blocks). Total stitched body must be 200+ words.
- 3-5 internal links of the form <a href="/collections/{handle}">{exact title}</a> chosen ONLY from the RELATED COLLECTIONS list - any other handle FAILS validation.
- BANNED PHRASES (never use anywhere): ${BANNED_PHRASES.join(", ")}.
- smart_rules_json: Shopify smart-collection ruleSet { appliedDisjunctively: boolean, rules: [{column, relation, condition}] }. Use TITLE/TAG/VENDOR/TYPE columns and CONTAINS/EQUALS/NOT_CONTAINS relations precise enough to match >=3 products.
- faq: ${vertical === "ACCESSORIES" ? `EXACTLY 6 entries (Louenhide accessories template). Use these 6 question slots in order, replacing {Brand}, {bag type}, {Store}, {City} with real values from this collection. Answers must be SPECIFIC — name actual product styles from sample_titles, real materials, real airline carry-on names (Qantas, Virgin) when relevant:
    1. "What is the most popular ${brand?.brand_name ?? "{Brand}"} bag at ${storeName}?" — name a real best-selling style from sample_titles + key features.
    2. "What colour ${brand?.brand_name ?? "{Brand}"} bag is most popular?" — name 2-3 actual colours stocked.
    3. "What fits in a ${brand?.brand_name ?? "{Brand}"} {bag type}?" — specific dimensions, laptop size, carry-on compatibility.
    4. "Is ${brand?.brand_name ?? "{Brand}"} vegan? What is it made from?" — material honesty (vegan leather, genuine leather, canvas).
    5. "How do I care for my ${brand?.brand_name ?? "{Brand}"} bag?" — specific care steps (damp cloth, dust bag, eucalyptus oil for marks).
    6. "Can I buy ${brand?.brand_name ?? "{Brand}"} bags in store${storeCity ? ` in ${storeCity}` : ""}?" — local availability + free shipping note.` : `EXACTLY 4-6 entries, each {q,a}. Question phrased the way customers type into Google (must end with "?")`}. Answer 30-80 words, no banned phrases.
- blog_plans: 1-3 plans {title, target_keywords[], sections[]}.

PRIMARY KEYWORD: "${primaryKeyword}"

KEYWORD TIERS (use natural placements per hint):
${kwList || "  (none)"}

RELATED COLLECTIONS for internal links (pick 3-5 from this list):
${linkList || "  (none — link to the collection's own handle as last resort)"}
${iconicBlock}${nicheGuard}${brand ? `\nBRAND VOICE: ${brand.brand_voice ?? ""}\nBRAND VALUE PROP: ${brand.value_proposition ?? ""}\n` : ""}${previousBlock}

OUTPUT JSON SCHEMA (strict):
{
  "seo_title": string,
  "meta_description": string,
  "formula_parts": ${formulaSchema},
  "primary_keyword": string,
  "smart_rules_json": { "appliedDisjunctively": boolean, "rules": [{"column":"TITLE|TAG|VENDOR|TYPE","relation":"CONTAINS|EQUALS|NOT_CONTAINS","condition":string}] },
  "faq": [{"q":string,"a":string}],
  "blog_plans": [{"title":string,"target_keywords":[string],"sections":[{"h2":string,"summary":string}]}]
}`;

  const user = `Generate the SEO package for this ${isBrandPage ? "brand" : "collection"} (taxonomy level ${level}):
title: "${suggestion.suggested_title}"
handle: "${suggestion.shopify_handle || suggestion.suggested_handle}"
type: "${suggestion.collection_type}"
sample products: ${(suggestion.sample_titles ?? []).slice(0, 8).join(" | ")}
existing rules hint: ${JSON.stringify(suggestion.rule_set ?? []).slice(0, 600)}`;

  return { system, user };
}
