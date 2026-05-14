// sonic-ask — Conversational expert assistant for Sonic Invoices.
// LLM_CALL pattern (one-shot per user turn). Direct Anthropic API.
// System prompt = live store context + distilled skill knowledge.
//
// POST { message: string, conversation_history: {role,content}[] }
// Auth: Supabase JWT (verify_jwt = true via default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1024;
const MAX_HISTORY = 20;

const EXPERT_KNOWLEDGE = `
## TAGGING RULES
Australian fashion uses a 7-layer tag formula:
1. Brand: lowercase-hyphenated (seafolly, kulani-kinis, bond-eye)
2. Type: bikini-top, bikini-bottom, one-piece, rash-guard, coverup, boardshort, dress, top, bottom
3. Colour: primary colour lowercase (black, teal, coral, floral, stripe)
4. Material/feature: underwire, dd-cup, upf-50, chlorine-resistant, tummy-control
5. Season: spring-26, summer-26, winter-26
6. Occasion: beach, resort, sport, bridal, festival
7. Arriving: arriving-jan-2026 format

## SEO COLLECTION FORMULA
6-level URL hierarchy. 5-part description:
1. Keyword-loaded opener (brand + type + location)
2. Materials and features paragraph
3. Brand names mentioned explicitly
4. FAQ section (4-6 questions targeting People Also Ask)
5. Internal links to sibling collections
Meta description: 150-160 chars, location + brand + type formula.
SEO title: 30-60 chars. Body must include opening, features, styling, local, cta blocks.

## DARWIN RETAIL CONTEXT
Two seasons: wet (Nov-Apr), dry (May-Oct). Key events: Darwin Cup (Aug),
Dry Season fashion peak (Jun-Sep), Christmas (Dec), EOFY (Jun), Back to school (Jan-Feb).
Major AU swimwear brands: Seafolly, Kulani Kinis, Baku, Bond Eye, Jantzen, Sea Level.
Reference competitors: THE ICONIC, Mathers, David Jones.

## PRICING KNOWLEDGE
AU swimwear retail markup: 2.2-2.5x wholesale. Bikini tops $120-$220 RRP.
One pieces $180-$280. Footwear 2.0-2.3x. Dresses 2.3-2.8x.

## THREE-PATTERN AI DOCTRINE (internal)
Classify every AI feature as LLM_CALL (one-shot), AUTOMATION_FLOW (cron/rule, no LLM hot path),
or AI_AGENT (tool-using loop). Never use an Agent for what an automation can do.
`.trim();

interface ChatMessage { role: "user" | "assistant"; content: string }

async function fetchContext(userId: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [{ data: conn }, { data: cols }, { data: brands }, { count: gapCount }, { count: invoiceCount }] = await Promise.all([
    admin.from("shopify_connections").select("store_url").eq("user_id", userId).maybeSingle(),
    admin.from("collection_suggestions").select("suggested_title,shopify_handle,completeness_score,status").eq("store_domain", "").or(`store_domain.neq.`).limit(10),
    admin.from("brand_intelligence").select("brand_name").eq("user_id", userId).limit(10),
    admin.from("competitor_gaps").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
    admin.from("invoice_processing_jobs").select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  // Re-fetch collections scoped properly (collection_suggestions has no user_id directly)
  const { data: realCols } = await admin
    .from("collection_suggestions")
    .select("suggested_title,shopify_handle,completeness_score,status")
    .order("completeness_score", { ascending: true, nullsFirst: false })
    .limit(10);

  const storeUrl = conn?.store_url || "(no Shopify store connected)";
  const colSummary = (realCols ?? cols ?? [])
    .map((c: any) => `  - ${c.suggested_title || c.shopify_handle || "(untitled)"} — score ${c.completeness_score ?? 0}/100, ${c.status || "draft"}`)
    .join("\n") || "  (no collections yet)";
  const brandList = (brands ?? []).map((b: any) => b.brand_name).filter(Boolean).join(", ") || "(no brands tracked)";

  return `## LIVE STORE CONTEXT
Store: ${storeUrl}
Pending SEO gaps: ${gapCount ?? 0}
Invoice jobs processed: ${invoiceCount ?? 0}
Top brands tracked: ${brandList}
Lowest-scoring collections (focus areas):
${colSummary}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const message: string = String(body.message || "").trim();
    const history: ChatMessage[] = Array.isArray(body.conversation_history) ? body.conversation_history : [];
    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmedHistory = history.slice(-MAX_HISTORY).filter(m =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()
    );

    const liveContext = await fetchContext(user.id).catch((e) => {
      console.warn("[sonic-ask] context fetch failed:", e);
      return "## LIVE STORE CONTEXT\n(unavailable this turn)";
    });

    const systemPrompt = `You are Sonic AI — an embedded expert assistant inside Sonic Invoices, a Shopify stock-intake and SEO automation tool for Australian independent retailers (boutique fashion, swimwear, footwear).

You answer the store owner's questions using the live data and expert knowledge below. Be concise, specific, and practical.

## ACTION RULES (strict)
- Never claim to be executing an action (generating SEO, creating a collection, pushing to Shopify, parsing an invoice) — you cannot take those actions from this chat panel.
- You may explain *what* Sonic would do and *where* to do it.
- If the user asks for something actionable, end your response with the exact path in this format: "Go to [Tab] → [Page] → [Button]" (e.g. "Go to Collections → black-dresses → Generate SEO content").

${liveContext}

${EXPERT_KNOWLEDGE}

Tone: confident, retail-savvy, no fluff. Default to short answers (2-5 sentences) unless the user asks for detail. Use markdown sparingly (lists, bold) when it helps scanability.`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
          ...trimmedHistory.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("[sonic-ask] anthropic error", anthropicResp.status, errText);
      return new Response(JSON.stringify({ error: `Anthropic ${anthropicResp.status}`, detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await anthropicResp.json();
    const reply = data?.content?.[0]?.text || "(no response)";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sonic-ask] error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
