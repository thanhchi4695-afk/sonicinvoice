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

function stitchDescription(parts: any, isBrandPage: boolean, voice: VoiceStyle): string {
  if (isBrandPage) {
    return [
      `<p>${parts.brand_origin ?? ""}</p>`,
      `<p>${parts.brand_seasonal ?? ""}</p>`,
      `<p>${parts.brand_authority ?? ""}</p>`,
      `<p>${parts.brand_sub_links ?? ""}</p>`,
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

type VoiceStyle = "aspirational_youth" | "professional_editorial" | "local_warmth" | "luxury_refined";

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
    const vertical = (body.vertical || "FOOTWEAR").toUpperCase();
    const storeName = body.store_name || "Our Store";
    const storeCity = body.store_city || null;

    // Load brand voice style from this user's shopify connection (default local_warmth)
    const { data: conn } = await supabase
      .from("shopify_connections")
      .select("brand_voice_style")
      .eq("user_id", suggestion.user_id)
      .maybeSingle();
    const voice: VoiceStyle = (conn?.brand_voice_style as VoiceStyle) || "local_warmth";

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

    // Brand intelligence + ICONIC reference
    let brand: any = null;
    if (level === 5 && body.brand_id) {
      const { data } = await supabase
        .from("brand_intelligence")
        .select("brand_name, brand_voice, value_proposition, hero_keywords, iconic_reference, whitefox_reference, competitor_reference_styletread")
        .eq("id", body.brand_id)
        .maybeSingle();
      brand = data;
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
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.4,
      });
      const raw = getContent(ai);
      parsed = safeParseJson(raw);
      if (!parsed) {
        lastIssues = [{ field: "_parse", message: "Model did not return JSON" }];
        continue;
      }
      const description_html = stitchDescription(parsed.formula_parts || {}, isBrandPage, voice);
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

    return json({
      ok: true,
      level,
      is_brand_page: isBrandPage,
      validation_errors: lastIssues,
      shopify_push: push,
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
}) {
  const { suggestion, level, isBrandPage, vertical, storeName, storeCity, keywords, brand, linkOptions, primaryKeyword, previousIssues } = opts;

  const titleFormulas: Record<Level, string> = {
    2: "{Audience} {Category} | " + storeName,
    3: "{Audience} {Type} | " + storeName,
    4: "{Audience} {Sub-type} | " + storeName,
    5: "{Brand}" + (vertical === "FOOTWEAR" ? " Shoes" : "") + " | " + storeName,
    6: "{Occasion}" + (storeCity ? " " + storeCity : "") + " | " + storeName,
  };

  // Competitor reference router:
  //   FOOTWEAR or professional/luxury voice -> ICONIC (marketplace breadth)
  //   CLOTHING/SWIMWEAR + aspirational/warmth voice -> White Fox (single-brand DTC)
  const useWhiteFox =
    (vertical === "CLOTHING" || vertical === "SWIMWEAR") &&
    (voice === "aspirational_youth" || voice === "local_warmth") &&
    !!brand?.whitefox_reference;
  const refLabel = useWhiteFox ? "WHITE FOX REFERENCE" : "THE ICONIC REFERENCE";
  const refData = useWhiteFox ? brand?.whitefox_reference : brand?.iconic_reference;
  const iconicBlock = refData
    ? `\n${refLabel} for ${brand?.brand_name ?? "this brand"} (match vocabulary, do not plagiarise):\n` +
      JSON.stringify(refData).slice(0, 1800) + "\n"
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

  const formulaSchema = isBrandPage
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
- faq: EXACTLY 4-6 entries, each {q,a}. Question phrased the way customers type into Google (must end with "?"). Answer 30-80 words, no banned phrases.
- blog_plans: 1-3 plans {title, target_keywords[], sections[]}.

PRIMARY KEYWORD: "${primaryKeyword}"

KEYWORD TIERS (use natural placements per hint):
${kwList || "  (none)"}

RELATED COLLECTIONS for internal links (pick 3-5 from this list):
${linkList || "  (none — link to the collection's own handle as last resort)"}
${iconicBlock}${brand ? `\nBRAND VOICE: ${brand.brand_voice ?? ""}\nBRAND VALUE PROP: ${brand.value_proposition ?? ""}\n` : ""}${previousBlock}

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
