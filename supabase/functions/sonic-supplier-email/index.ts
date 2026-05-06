// Sonic supplier email writer — calls Anthropic Claude.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TYPE_SUBJECTS: Record<string, string> = {
  reorder: "Reorder request",
  followup: "Order status follow-up",
  price_query: "Pricing & terms enquiry",
  return: "Return — faulty goods",
  intro: "Introduction from a new stockist",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      supplier_name,
      email_type = "reorder",
      product_details = "",
      user_name = "",
      store_name = "",
      tone_variant = 0,
    } = await req.json();

    if (!supplier_name) {
      return new Response(
        JSON.stringify({ error: "supplier_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const toneNote = tone_variant === 1
      ? " Use a slightly warmer, more conversational tone."
      : tone_variant === 2
      ? " Use a more direct, no-nonsense tone."
      : "";

    const sys =
      "You are an assistant for an Australian independent retail store. Write professional but friendly supplier emails. Keep them short — under 120 words. Sign off with the user's name and store name. Australian English spelling. No fluff, no excessive pleasantries. Get to the point in the first sentence." +
      toneNote +
      " Return your response strictly as JSON with two keys: subject (short, specific) and body (the email text including greeting and sign-off). Do not include any other text.";

    const userPrompt =
      `Write a ${email_type} email to ${supplier_name}. ` +
      `Store: ${store_name || "our store"}, Darwin NT, Australia. ` +
      `Details: ${product_details || "(none provided)"}. ` +
      `Sender: ${user_name || "the buyer"}.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        system: sys,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Anthropic error:", resp.status, t);
      return new Response(
        JSON.stringify({ error: `Claude error ${resp.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const raw: string = (data?.content?.[0]?.text ?? "").trim();

    let subject = TYPE_SUBJECTS[email_type] ?? "Quick note";
    let body = raw;
    // Try to parse JSON envelope; fall back to raw text.
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.subject === "string" && parsed.subject.trim()) {
          subject = parsed.subject.trim();
        }
        if (typeof parsed.body === "string" && parsed.body.trim()) {
          body = parsed.body.trim();
        }
      }
    } catch {
      // Heuristic: pull "Subject: ..." line if present
      const subjMatch = raw.match(/^subject:\s*(.+)$/im);
      if (subjMatch) {
        subject = subjMatch[1].trim();
        body = raw.replace(subjMatch[0], "").trim();
      }
    }

    return new Response(
      JSON.stringify({ subject, body, supplier_name, email_type }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sonic-supplier-email error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
