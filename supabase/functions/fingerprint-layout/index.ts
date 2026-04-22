// ──────────────────────────────────────────────────────────────
// Stage 2 — LAYOUT FINGERPRINT
// Given the Stage-1 orientation result + the same document image,
// classify the LAYOUT shape so Stage 3 knows how to walk the rows.
// ──────────────────────────────────────────────────────────────

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LAYOUT_PROMPT = `You are the Layout Fingerprint stage of a 5-stage invoice extraction pipeline.

You receive the orientation summary from Stage 1 and the document image.
Your ONLY job is to classify the layout shape so the next stage can walk the rows correctly.

Return STRICT JSON — no markdown fences, no commentary:

{
  "layout_type":  "flat_rows" | "parent_child" | "variants_as_columns" | "multi_section",
  "rows_per_product": "one" | "many",
  "variant_axis":  "rows" | "columns" | "none",
  "spans_multiple_pages": true | false,
  "has_section_headers":  true | false,
  "size_columns": ["6","8","10","12","14"],
  "notes": "1-2 short sentences explaining the choice",
  "confidence": 0-100
}

Definitions:
- "flat_rows"            → one product per row, all info on that row.
- "parent_child"         → a parent row (style/product) is followed by child rows for each variant
                            (size/colour). Inherit context from parent.
- "variants_as_columns"  → size labels are COLUMN HEADERS (e.g. 6 8 10 12 14 or XS S M L) and each
                            cell under them is a quantity for that size.
- "multi_section"        → the document has SECTION HEADERS between groups
                            (e.g. brand name, collection, season) and rows below inherit that context.

"size_columns" must only be populated when layout_type is "variants_as_columns" — list the literal
header values left-to-right in the order they appear.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileContent, fileType, fileName, orientation } = await req.json();
    if (!fileContent || !orientation) {
      return new Response(
        JSON.stringify({ error: "fileContent and orientation are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = (fileType || "jpeg").toLowerCase();
    const mime =
      ext === "pdf" ? "application/pdf" :
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      `image/${ext === "jpg" ? "jpeg" : ext}`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      messages: [
        { role: "system", content: LAYOUT_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${fileContent}` } },
            {
              type: "text",
              text:
                `File: ${fileName || "unknown"}.\n\n` +
                `Stage-1 orientation result:\n${JSON.stringify(orientation, null, 2)}\n\n` +
                `Now classify the layout. Return ONLY the JSON shape described above.`,
            },
          ],
        },
      ],
    });

    const raw = getContent(data);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (m?.[1] || raw).trim();

    let layout: Record<string, unknown>;
    try {
      layout = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Layout pass returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    layout.layout_type = (layout.layout_type as string) || "flat_rows";
    layout.spans_multiple_pages = !!layout.spans_multiple_pages;
    layout.has_section_headers = !!layout.has_section_headers;
    layout.size_columns = Array.isArray(layout.size_columns) ? layout.size_columns : [];
    layout.confidence = Number(layout.confidence) || 70;

    return new Response(
      JSON.stringify({ layout, stage: "fingerprint" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("fingerprint-layout error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Layout fingerprint failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
