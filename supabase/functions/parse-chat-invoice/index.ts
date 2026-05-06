// Lightweight invoice parser for pasted text (no PDF / image).
// Calls Gemini 2.5 Flash via the Lovable AI Gateway and returns structured rows
// matching the same shape as parse-invoice Stage 1, so the client can pipe them
// through tag-engine + seo-engine before exporting CSV.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface ParsedRow {
  productName?: string | null;
  styleNumber?: string | null;
  colour?: string | null;
  size?: string | null;
  quantity?: number | null;
  costPrice?: number | null;
  rrp?: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { text?: string; supplier?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const text = (body.text ?? "").trim();
  const supplier = (body.supplier ?? "Unknown supplier").trim();
  if (!text || text.length < 20) {
    return new Response(JSON.stringify({ error: "Need at least 20 chars of invoice text" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tools = [{
    type: "function",
    function: {
      name: "return_invoice_rows",
      description: "Return parsed invoice line items.",
      parameters: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productName: { type: ["string", "null"] },
                styleNumber: { type: ["string", "null"] },
                colour: { type: ["string", "null"] },
                size: { type: ["string", "null"] },
                quantity: { type: ["number", "null"] },
                costPrice: { type: ["number", "null"] },
                rrp: { type: ["number", "null"] },
              },
              required: ["productName", "styleNumber", "colour", "size", "quantity", "costPrice", "rrp"],
              additionalProperties: false,
            },
          },
        },
        required: ["rows"],
        additionalProperties: false,
      },
    },
  }];

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a precise invoice parser. Extract every product line item from the text. Numbers must be plain numbers (no currency symbols). Use null when unsure.",
          },
          {
            role: "user",
            content:
              `Supplier: ${supplier}\n\nInvoice text:\n${text}\n\nExtract every product line. For each: productName, styleNumber, colour, size, quantity, costPrice (unit ex-tax), rrp (if shown).`,
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "return_invoice_rows" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      if (resp.status === 429)
        return new Response(JSON.stringify({ error: "AI rate limit — try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (resp.status === 402)
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      throw new Error(`Gemini failed: ${resp.status} ${t.slice(0, 200)}`);
    }

    const json = await resp.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments || "{}") : {};
    const rows: ParsedRow[] = Array.isArray(args.rows) ? args.rows : [];
    return new Response(JSON.stringify({ rows, supplier }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
