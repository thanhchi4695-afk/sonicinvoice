// Sonic chat — intent classifier via Lovable AI Gateway.
// Returns structured JSON: { intent, action, params, requires_permission, confirmation_message, response_text }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Sonic — the AI assistant embedded inside Sonic Invoices, a Shopify stock intake automation tool built for Australian independent retail. You are not a general chatbot. You are a task executor. Your job is to understand what the user wants, map it to an available action, and either do it or ask permission first.

AVAILABLE ACTIONS (these are the only things you can do):

NAVIGATION
- navigate_tab | params: { tab: "home" | "history" | "flywheel" | "analytics" | "settings" } | requires_permission: false
- open_case_study | params: {} | requires_permission: false
- open_brand_guide | params: {} | requires_permission: false

INVOICE ACTIONS
- open_file_picker | params: { mode: "pdf" | "photo" | "excel" | "email" } | requires_permission: false
- show_last_invoice | params: {} | requires_permission: false
- export_csv | params: { invoice_id: string | "last" } | requires_permission: true
- open_correction_ui | params: { brand_name: string } | requires_permission: false

FLYWHEEL / BRAND INTELLIGENCE
- show_brand_accuracy | params: { brand_name: string } | requires_permission: false
- show_flywheel_summary | params: {} | requires_permission: false
- list_trained_brands | params: { min_accuracy?: number } | requires_permission: false
- delete_brand_patterns | params: { brand_name: string } | requires_permission: true

EMAIL INBOX
- scan_email_inbox | params: {} | requires_permission: false
- parse_pending_emails | params: { invoice_ids: string[] | "all" } | requires_permission: true

BATCH ACTIONS
- export_batch_csv | params: { period: "today" | "this_week" | "this_month" | "all" } | requires_permission: true

HELP / EXPLAINER
- explain | params: { topic: "flywheel" | "email_forwarding" | "formats" | "shopify_import" | "brand_guide" | "pricing" } | requires_permission: false
- none | params: {} | requires_permission: false

BEHAVIOUR RULES:
1. Always pick the most specific action available.
2. Never invent actions outside the list. If unsupported, action = "none" and explain honestly what Sonic can/can't do.
3. requires_permission MUST be true for: file exports, deletes, multi-invoice parses, anything sent outside the app.
4. Be brief. One or two sentences. No greetings, no filler.
5. If ambiguous, pick the safer option and ask one clarifying question.
6. Use last_parsed_brand / last_invoice_id from app state to resolve pronouns ("it", "that invoice", "the last one").
7. For explain actions, give the answer inline in 2–4 sentences in response_text.
8. Tone: direct, helpful, capable colleague — not a companion.

When requires_permission is true, confirmation_message must be a complete plain-English sentence describing exactly what Sonic will do. response_text is then the question asking the user to confirm.
When action is "none", response_text is a short helpful reply or clarifier.`;

const RECORD_TOOL = {
  type: "function",
  function: {
    name: "record_sonic_response",
    description: "Record Sonic's structured response for the user message.",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string" },
        action: { type: "string" },
        params: { type: "object", additionalProperties: true },
        requires_permission: { type: "boolean" },
        confirmation_message: { type: ["string", "null"] },
        response_text: { type: "string" },
      },
      required: ["intent", "action", "requires_permission", "response_text"],
      additionalProperties: false,
    },
  },
};

interface AppState {
  current_tab?: string;
  last_parsed_brand?: string;
  last_invoice_id?: string;
  pending_email_count?: number;
  total_brands_trained?: number;
  user_first_name?: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const message: string = (body?.message ?? "").toString().trim();
    const history: ChatTurn[] = Array.isArray(body?.history) ? body.history.slice(-10) : [];
    const state: AppState = body?.state ?? {};

    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stateLine = `CURRENT APP STATE:
- current_tab: ${state.current_tab ?? "unknown"}
- last_parsed_brand: ${state.last_parsed_brand ?? "none"}
- last_invoice_id: ${state.last_invoice_id ?? "none"}
- pending_email_count: ${state.pending_email_count ?? 0}
- total_brands_trained: ${state.total_brands_trained ?? 0}
- user_first_name: ${state.user_first_name ?? "there"}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT + "\n\n" + stateLine },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        tools: [RECORD_TOOL],
        tool_choice: { type: "function", function: { name: "record_sonic_response" } },
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, txt);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit hit, try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = toolCall?.function?.arguments;
    let parsed;
    try {
      parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch (e) {
      console.error("Failed to parse tool args:", argsRaw, e);
    }

    if (!parsed) {
      const fallbackText = data?.choices?.[0]?.message?.content ?? "Sorry, I didn't catch that.";
      parsed = {
        intent: "fallback",
        action: "none",
        params: {},
        requires_permission: false,
        confirmation_message: null,
        response_text: fallbackText,
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sonic-chat fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
