// Generates the full HTML for an approved collection_blog_plans row using
// Lovable AI Gateway. Persists generated_html + flips status to "generated".
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import { BANNED_PHRASES } from "../_shared/seo-validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  plan_id: string;
  store_name?: string;
  store_city?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body?.plan_id) return json({ error: "plan_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("app_settings")
      .select("brand_intelligence_enabled")
      .eq("singleton", true)
      .maybeSingle();
    if (settings && settings.brand_intelligence_enabled === false) {
      return json({ error: "Brand intelligence is disabled" }, 423);
    }

    const { data: plan, error: pErr } = await supabase
      .from("collection_blog_plans")
      .select("*")
      .eq("id", body.plan_id)
      .maybeSingle();
    if (pErr || !plan) return json({ error: "plan not found" }, 404);

    const { data: seoOut } = await supabase
      .from("collection_seo_outputs")
      .select("seo_title, meta_description, layer")
      .eq("suggestion_id", plan.suggestion_id)
      .maybeSingle();
    const { data: suggestion } = await supabase
      .from("collection_suggestions")
      .select("suggested_title, suggested_handle, collection_type, sample_titles")
      .eq("id", plan.suggestion_id)
      .maybeSingle();

    const storeName = body.store_name || "Our Store";
    const storeCity = body.store_city || "";

    const sectionsList = Array.isArray(plan.sections)
      ? (plan.sections as Array<{ h2: string; summary?: string }>)
        .map((s) => `- ${s.h2}${s.summary ? ` — ${s.summary}` : ""}`).join("\n")
      : "";
    const faqList = Array.isArray(plan.faq)
      ? (plan.faq as Array<{ q: string; a?: string }>)
        .map((f) => `Q: ${f.q}`).join("\n")
      : "";
    const targetKw: string[] = Array.isArray(plan.target_keywords) ? plan.target_keywords : [];

    const system = `You are an Australian retail blog writer for ${storeName}${storeCity ? ` (${storeCity})` : ""}.
Write a single SEO blog post in clean semantic HTML.

HARD RULES:
- 900-1300 words.
- Open with an H1 matching the title.
- Use the H2 outline below in order. Add 2-4 short paragraphs under each H2. Keep paragraphs <80 words.
- Include the primary keyword "${targetKw[0] ?? plan.title}" in the first paragraph.
- Include 1-2 internal links of the form <a href="/collections/${suggestion?.suggested_handle ?? ""}">${suggestion?.suggested_title ?? "shop the collection"}</a>.
- Close with an H2 "FAQ" containing each question as <h3> and answer as <p>.
- BANNED PHRASES (never use): ${BANNED_PHRASES.join(", ")}.
- Output ONLY HTML. No markdown, no code fences, no commentary.`;

    const user = `TITLE: ${plan.title}
TARGET KEYWORDS: ${targetKw.join(", ")}
COLLECTION CONTEXT: ${suggestion?.suggested_title ?? ""} (handle: ${suggestion?.suggested_handle ?? ""})
SEO TITLE OF COLLECTION: ${seoOut?.seo_title ?? ""}
META: ${seoOut?.meta_description ?? ""}

SECTIONS:
${sectionsList || "- Introduction\n- Why it matters\n- How to choose\n- Tips"}

FAQ QUESTIONS (answer each in 2-4 sentences):
${faqList || "Q: What should I look for?\nQ: How do I care for it?"}

SAMPLE PRODUCTS for inspiration: ${(suggestion?.sample_titles ?? []).slice(0, 6).join(" | ")}`;

    const ai = await callAI({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.6,
    });
    const html = getContent(ai)
      .replace(/```html\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    if (!html || html.length < 400) {
      return json({ error: "Model returned insufficient HTML", length: html.length }, 502);
    }

    const banned = BANNED_PHRASES.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(html));
    if (banned.length > 0) {
      return json({ error: "Banned phrases detected", banned }, 422);
    }

    const { error: upErr } = await supabase
      .from("collection_blog_plans")
      .update({
        generated_html: html,
        status: "generated",
        generated_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, plan_id: plan.id, length: html.length });
  } catch (e) {
    console.error("seo-blog-writer error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
