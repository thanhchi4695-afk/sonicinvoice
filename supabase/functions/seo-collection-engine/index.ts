// supabase/functions/seo-collection-engine/index.ts
// Universal SEO Collection Engine - generates the 5 outputs (title, meta,
// description HTML, smart-collection rules JSON, blog plan + FAQ) for a
// collection_suggestions row, validates them deterministically, and persists
// to collection_seo_outputs + collection_blog_plans.

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import {
  validateSeoOutput,
  type ValidationIssue,
  BANNED_PHRASES,
} from "../_shared/seo-validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Layer = 1 | 2 | 3 | 4;

interface RunBody {
  suggestion_id: string;
  vertical?: string;          // FOOTWEAR | SWIMWEAR | CLOTHING | ACCESSORIES | LIFESTYLE
  store_name?: string;
  store_city?: string;        // for local signal injection
  brand_id?: string;          // brand_intelligence row to consult
}

function inferLayer(suggestion: any): Layer {
  const t: string = suggestion.collection_type || "";
  if (t === "brand" || t === "brand_category" || t === "brand_print") return 2;
  // colour / pattern / print => layer 4
  if (t === "print" || t === "dimension") return 4;
  // niche/archive => occasion/feature => layer 3
  if (t === "niche" || t === "archive") return 3;
  // type / fallback => layer 1
  return 1;
}

function bucketsForLayer(layer: Layer): string[] {
  switch (layer) {
    case 1: return ["high_volume", "type_specific"];
    case 2: return ["brand_long_tail", "type_specific"];
    case 3: return ["occasion", "feature", "local"];
    case 4: return ["colour", "material"];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = (await req.json()) as RunBody;
    if (!body?.suggestion_id) {
      return json({ error: "suggestion_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // App-level kill switch
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

    const layer = inferLayer(suggestion);
    const vertical = (body.vertical || "FOOTWEAR").toUpperCase();
    const storeName = body.store_name || "Our Store";
    const storeCity = body.store_city || null;

    // Pull keyword library for the vertical + relevant buckets
    const buckets = bucketsForLayer(layer);
    const { data: keywords } = await supabase
      .from("seo_keyword_library")
      .select("bucket, keyword, city")
      .in("vertical", [vertical, "MULTI"])
      .in("bucket", buckets);

    // Brand intelligence (optional - layer 2)
    let brand: any = null;
    if (layer === 2 && body.brand_id) {
      const { data } = await supabase
        .from("brand_intelligence")
        .select("brand_name, brand_voice, value_proposition, hero_keywords, blog_topic_distribution, competitor_reference_styletread")
        .eq("id", body.brand_id)
        .maybeSingle();
      brand = data;
    }

    // Two related collections for internal links - sibling suggestions same user
    const { data: siblings } = await supabase
      .from("collection_suggestions")
      .select("suggested_title, suggested_handle")
      .eq("user_id", suggestion.user_id)
      .neq("id", suggestion.id)
      .limit(6);

    const primaryKeyword = pickPrimaryKeyword(suggestion, keywords ?? []);

    // Run model with up to 3 attempts (initial + 2 corrective retries)
    let lastIssues: ValidationIssue[] = [];
    let parsed: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = buildPrompt({
        suggestion,
        layer,
        vertical,
        storeName,
        storeCity,
        keywords: keywords ?? [],
        brand,
        siblings: siblings ?? [],
        primaryKeyword,
        previousIssues: lastIssues,
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
      lastIssues = validateSeoOutput(
        {
          seo_title: parsed.seo_title,
          meta_description: parsed.meta_description,
          description_html: parsed.description_html,
          smart_rules_json: parsed.smart_rules_json,
        },
        { layer, primary_keyword: primaryKeyword, city: storeCity },
      );
      if (lastIssues.length === 0) break;
    }

    if (!parsed) {
      return json({ error: "Model parse failure", issues: lastIssues }, 502);
    }

    // Store result (status = draft if validation issues remain)
    const status = lastIssues.length === 0 ? "draft" : "draft";
    const expiresAt = layer === 4
      ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 6).toISOString()
      : null;

    const { error: upErr } = await supabase
      .from("collection_seo_outputs")
      .upsert(
        {
          suggestion_id: suggestion.id,
          layer,
          seo_title: parsed.seo_title?.slice(0, 60) ?? "",
          meta_description: parsed.meta_description ?? "",
          description_html: parsed.description_html ?? "",
          smart_rules_json: parsed.smart_rules_json ?? null,
          rules_validated_count: 0,
          rules_status: "pending",
          status,
          validation_errors: lastIssues.length ? lastIssues : null,
          refreshed_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: "suggestion_id" },
      );
    if (upErr) return json({ error: upErr.message }, 500);

    // Persist blog plans
    if (Array.isArray(parsed.blog_plans) && parsed.blog_plans.length > 0) {
      const rows = parsed.blog_plans.slice(0, 6).map((b: any, idx: number) => ({
        suggestion_id: suggestion.id,
        blog_index: idx + 1,
        title: String(b.title || "").slice(0, 200),
        target_keywords: Array.isArray(b.target_keywords) ? b.target_keywords.slice(0, 8) : [],
        sections: b.sections ?? [],
        faq: Array.isArray(parsed.faq) && idx === 0 ? parsed.faq : (b.faq ?? []),
        status: "plan",
      }));
      // wipe + reinsert to keep clean
      await supabase.from("collection_blog_plans").delete().eq("suggestion_id", suggestion.id);
      if (rows.length > 0) {
        await supabase.from("collection_blog_plans").insert(rows);
      }
    }

    return json({
      ok: true,
      layer,
      validation_errors: lastIssues,
      output: parsed,
    });
  } catch (e) {
    console.error("seo-collection-engine error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeParseJson(raw: string): any {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* */ }
  }
  return null;
}

function pickPrimaryKeyword(suggestion: any, keywords: Array<{ keyword: string; bucket: string }>) {
  // Prefer a keyword in the suggested title
  const t = (suggestion.suggested_title || "").toLowerCase();
  const hit = keywords.find((k) => t.includes(k.keyword.toLowerCase().split(" ")[0]));
  if (hit) return hit.keyword;
  return keywords[0]?.keyword || suggestion.suggested_title || "";
}

function buildPrompt(opts: {
  suggestion: any;
  layer: Layer;
  vertical: string;
  storeName: string;
  storeCity: string | null;
  keywords: Array<{ bucket: string; keyword: string; city?: string | null }>;
  brand: any;
  siblings: Array<{ suggested_title: string; suggested_handle: string }>;
  primaryKeyword: string;
  previousIssues: ValidationIssue[];
}) {
  const { suggestion, layer, vertical, storeName, storeCity, keywords, brand, siblings, primaryKeyword, previousIssues } = opts;

  const titleFormulas = {
    1: "{Womens/Mens/Kids} {Type} | " + storeName,
    2: "{Brand} " + (vertical === "FOOTWEAR" ? "Shoes" : "Swimwear") + " | " + storeName,
    3: "{Feature/Occasion}" + (storeCity ? " " + storeCity : "") + " | " + storeName,
    4: "{Colour/Print} {Type} | " + storeName,
  } as const;

  const styletreadBlock = brand?.competitor_reference_styletread
    ? "\nSTYLETREAD REFERENCE for " + brand.brand_name + " (use this vocabulary, do not plagiarise):\n" + JSON.stringify(brand.competitor_reference_styletread).slice(0, 2000) + "\n"
    : "";

  const previousBlock = previousIssues.length
    ? "\nPREVIOUS ATTEMPT FAILED with these issues - fix every one:\n" + previousIssues.map((i) => "- [" + i.field + "] " + i.message).join("\n") + "\n"
    : "";

  const sibList = (siblings ?? []).slice(0, 6)
    .map((s) => "  - \"" + s.suggested_title + "\" -> /collections/" + s.suggested_handle)
    .join("\n");

  const kwList = keywords.slice(0, 30).map((k) => "  - [" + k.bucket + "] " + k.keyword).join("\n");

  const system = "You are an expert Australian retail SEO copywriter generating a single collection page for " + storeName + (storeCity ? " (" + storeCity + ")" : "") + " in the " + vertical + " vertical.\nYou MUST output ONLY valid JSON matching the exact schema below. No markdown, no commentary.\n\nHARD RULES (failure = retry):\n- seo_title: max 60 chars. Formula for layer " + layer + ": " + titleFormulas[layer] + "\n- meta_description: EXACTLY 150-160 characters. Include the primary keyword in the first 12 words. Subtle action phrase. Include \"" + storeName + "\". " + (layer === 3 && storeCity ? "Include \"" + storeCity + "\"." : "") + "\n- description_html: 200-280 words HTML. Open with a sentence containing the primary keyword in the first 12 words. Use <p> paragraphs, ONE <ul> with 3 specific <li> benefits, EXACTLY 2 internal links of the form <a href=\"/collections/{handle}\">{exact title}</a> chosen from the related siblings list, and a closing CTA paragraph" + (storeCity ? " mentioning " + storeCity : "") + ".\n- BANNED PHRASES (never use): " + BANNED_PHRASES.join(", ") + ".\n- smart_rules_json: a Shopify smart-collection ruleSet { appliedDisjunctively: boolean, rules: [{column, relation, condition}] }. Use TITLE/TAG/VENDOR/TYPE columns and CONTAINS/EQUALS/NOT_CONTAINS relations. Be precise enough to match >=3 products.\n- blog_plans: 1-3 plans, each {title, target_keywords[], sections[]}. First plan also gets a 6-question faq[] of {q,a}.\n\nPRIMARY KEYWORD: \"" + primaryKeyword + "\"\n\nKEYWORD LIBRARY (use these where natural):\n" + (kwList || "  (none)") + "\n\nRELATED COLLECTIONS for internal links (pick 2):\n" + (sibList || "  (none - reuse the suggestion's own handle as last resort)") + "\n" + styletreadBlock + (brand ? "\nBRAND VOICE: " + (brand.brand_voice ?? "") + "\nBRAND VALUE PROP: " + (brand.value_proposition ?? "") + "\n" : "") + previousBlock + "\n\nOUTPUT JSON SCHEMA (strict):\n{\n  \"seo_title\": string,\n  \"meta_description\": string,\n  \"description_html\": string,\n  \"primary_keyword\": string,\n  \"smart_rules_json\": { \"appliedDisjunctively\": boolean, \"rules\": [{\"column\":\"TITLE|TAG|VENDOR|TYPE\",\"relation\":\"CONTAINS|EQUALS|NOT_CONTAINS\",\"condition\":string}] },\n  \"blog_plans\": [{\"title\":string,\"target_keywords\":[string],\"sections\":[{\"h2\":string,\"summary\":string}]}],\n  \"faq\": [{\"q\":string,\"a\":string}]\n}";

  const user = "Generate the SEO package for this collection (layer " + layer + "):\ntitle: \"" + suggestion.suggested_title + "\"\nhandle: \"" + suggestion.suggested_handle + "\"\ntype: \"" + suggestion.collection_type + "\"\nsample products: " + (suggestion.sample_titles ?? []).slice(0, 8).join(" | ") + "\nexisting rules hint: " + JSON.stringify(suggestion.rule_set ?? []).slice(0, 600);

  return { system, user };
}
