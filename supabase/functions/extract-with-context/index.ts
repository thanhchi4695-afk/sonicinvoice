// ──────────────────────────────────────────────────────────────
// Stages 3 + 4 — CONTEXT MAP BUILD + EXTRACTION WITH CONTEXT
// Single AI call that walks the document twice in one pass:
//   • First, build a context_map of section headers, parents,
//     merged-cell inheritance.
//   • Then extract every line item, inheriting missing fields
//     from the context_map and grouping variants per the rules.
// Receives the cached orientation + layout from Stages 1 and 2.
// ──────────────────────────────────────────────────────────────

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACT_PROMPT = `You are Stages 3 and 4 of a 5-stage fashion-invoice extraction pipeline.

You receive:
  • the Stage-1 orientation result
  • the Stage-2 layout fingerprint
  • the document image(s)

Your job in TWO passes inside ONE response:

PASS A — CONTEXT MAP
Walk the document top-to-bottom. For every row, determine:
  • inherited_brand        — nearest section header brand above this row
  • inherited_collection   — nearest section header collection above this row
  • inherited_style_code   — style code from a parent row above this variant
  • inherited_colour       — colour from a parent row above this variant
  • is_parent              — true if this row introduces children below it
  • is_variant_of_row      — index of the parent row, or null

PASS B — EXTRACTION
For every product line, output ONE entry. Each entry MUST already have its
context applied (do the inheritance yourself — do not leave fields blank
when context_map could fill them).

Apply these rules during extraction:

RULE 1 — Inherit missing fields from parent (use context_map):
  product_name = product_name || inherited_brand + " " + inherited_collection
  style_code   = style_code   || inherited_style_code
  colour       = colour       || inherited_colour

RULE 2 — Group variants automatically:
  Rows that share the same style_code, OR share product_name + colour,
  are variants of the same product. Emit ONE product with a "variants" array.

RULE 3 — Normalise costs (always emit BOTH):
  If gst_included == true and the cost field is cost_inc_gst:
      cost_ex_gst  = round(cost_inc_gst / 1.1, 2)
  Else if gst_included == false and cost field is cost_ex_gst:
      cost_inc_gst = round(cost_ex_gst * 1.1, 2)
  Always include rrp_ex_gst AND rrp_inc_gst the same way.

RULE 4 — Handle size columns:
  If layout_type == "variants_as_columns", each size column header is a size label
  and each cell value is the quantity for that size. For every column where qty > 0,
  emit one variant { size: column_header, quantity: cell_value, sku: "" }.

OUTPUT — STRICT JSON ONLY, no markdown fences:

{
  "context_map": {
    "<row_number>": {
      "inherited_brand": "",
      "inherited_collection": "",
      "inherited_style_code": "",
      "inherited_colour": "",
      "is_parent": false,
      "is_variant_of_row": null
    }
  },
  "products": [
    {
      "product_name": "",
      "style_code": "",
      "colour": "",
      "barcode": "",
      "description": "",
      "cost_ex_gst": 0,
      "cost_inc_gst": 0,
      "rrp_ex_gst": 0,
      "rrp_inc_gst": 0,
      "variants": [
        { "size": "", "quantity": 0, "sku": "", "barcode": "" }
      ],
      "source_rows": [1, 2, 3]
    }
  ],
  "extraction_notes": "1-3 short sentences about anything tricky"
}

Numbers must be JSON numbers, not strings. Empty strings rather than null for missing text.
Do NOT invent products — every product must trace to at least one source_row.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileContent, fileType, fileName, orientation, layout, customInstructions } = await req.json();
    if (!fileContent || !orientation || !layout) {
      return new Response(
        JSON.stringify({ error: "fileContent, orientation and layout are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = (fileType || "jpeg").toLowerCase();
    const mime =
      ext === "pdf" ? "application/pdf" :
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      `image/${ext === "jpg" ? "jpeg" : ext}`;

    const userText =
      `File: ${fileName || "unknown"}\n\n` +
      `Stage-1 orientation:\n${JSON.stringify(orientation, null, 2)}\n\n` +
      `Stage-2 layout:\n${JSON.stringify(layout, null, 2)}\n\n` +
      (customInstructions
        ? `User-provided rules (HIGHEST PRIORITY — override defaults):\n${customInstructions}\n\n`
        : "") +
      `Build the context_map, then extract every product applying RULES 1-4. Return ONLY the JSON shape.`;

    const data = await callAI({
      // Claude Sonnet 4.5 is the most accurate on structured tabular invoice
      // data. Falls back to Claude Haiku → Gemini 2.5 Flash via ai-gateway.
      model: "anthropic/claude-sonnet-4-5",
      temperature: 0.05,
      messages: [
        { role: "system", content: EXTRACT_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${fileContent}` } },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const raw = getContent(data);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (m?.[1] || raw).trim();

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Extraction returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    result.products = Array.isArray(result.products) ? result.products : [];
    result.context_map = result.context_map || {};

    return new Response(
      JSON.stringify({ ...result, stage: "extract" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("extract-with-context error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Extraction failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
