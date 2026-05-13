// Generate SEO content + 3 blog drafts for a collection_suggestions row.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface GeneratedPayload {
  seo_title: string;
  seo_description: string;
  description_html: string;
  blogs: Array<{ blog_type: "sizing" | "care" | "features" | "faq"; title: string; content_html: string }>;
}

function buildPrompt(s: Record<string, unknown>, related: string[]): string {
  return `COLLECTION CONTEXT:
Type: ${s.collection_type}
Name: ${s.suggested_title}
Products in collection: ${s.product_count}
Sample product titles: ${(s.sample_titles as string[] ?? []).slice(0, 5).join(" | ")}
Related existing collections on this store: ${related.slice(0, 8).join(", ") || "none"}
Store: Splash Swimwear — Darwin, NT, Australia

OUTPUT JSON ONLY (no prose, no markdown fences) with this exact shape:
{
  "seo_title": "string max 60 chars in form '<Collection> | Splash Swimwear Darwin'",
  "seo_description": "string max 155 chars, keyword-rich, mention Darwin where relevant",
  "description_html": "180-250 word HTML: <p> opener (2 sentences), <ul> with 3 <li> benefits, <p> with 2 internal anchor links to related collections using href='/collections/<handle>', <p> closing CTA mentioning Darwin",
  "blogs": [
    {"blog_type":"sizing","title":"...","content_html":"400-600 words HTML with <h2>/<p>/<ul>"},
    {"blog_type":"care","title":"...","content_html":"400-600 words HTML"},
    {"blog_type":"faq","title":"...","content_html":"6 Q&A pairs as <h3>+<p>"}
  ]
}
Australian English. No exaggerated claims. No fake material claims.`;
}

async function generate(s: Record<string, unknown>, related: string[]): Promise<GeneratedPayload> {
  const data = await callAI({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "system", content: "You are a senior SEO copywriter for Splash Swimwear in Darwin, NT. You output strict JSON only." },
      { role: "user", content: buildPrompt(s, related) },
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

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    // Pull related titles once for context
    const { data: related } = await admin
      .from("collection_suggestions")
      .select("suggested_title")
      .eq("user_id", userId)
      .in("status", ["published", "approved"])
      .limit(20);
    const relatedTitles = (related ?? []).map((r: any) => r.suggested_title);

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
        const out = await generate(s as any, relatedTitles);

        await admin.from("collection_suggestions").update({
          seo_title: out.seo_title,
          seo_description: out.seo_description,
          description_html: out.description_html,
          status: "content_ready",
          error_message: null,
        }).eq("id", id);

        // Replace any prior blogs for this suggestion (idempotent)
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
      // Throttle: max 5/min => 12s spacing, except after the last.
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 12000));
    }

    return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("collection-content-generator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
