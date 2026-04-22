// ──────────────────────────────────────────────────────────────
// Stage 1 — ORIENTATION PASS
// A dedicated, cheap AI call that ONLY answers the high-level
// shape of the document. The result is cached and threaded
// through every later stage in the 5-stage pipeline.
// ──────────────────────────────────────────────────────────────

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ORIENT_PROMPT = `You are the Orientation Pass of a 5-stage fashion-invoice extraction pipeline.

Your ONLY job is to answer high-level questions about THIS document. Do NOT extract line items.

Return STRICT JSON matching this shape — no markdown fences, no commentary:

{
  "supplier_name": "Best-effort exact supplier/brand name from header or letterhead",
  "document_type": "invoice" | "packing_slip" | "order_confirmation" | "credit_note",
  "currency": "AUD" | "USD" | "GBP" | "EUR" | "NZD" | "other",
  "gst_included": true | false,
  "table_start_page": 1,
  "column_headers": [
    { "label": "exact header text as printed", "maps_to": "<one of the allowed values>" }
  ],
  "confidence": 0-100,
  "notes": "1-2 short sentences on anything ambiguous"
}

Allowed values for "maps_to":
  product_name, style_code, colour, size, cost_ex_gst, cost_inc_gst,
  rrp_inc_gst, rrp_ex_gst, quantity, barcode, description, unknown

Detection guidance:
- "invoice"            → has prices AND quantities
- "packing_slip"       → has quantities, NO prices
- "order_confirmation" → looks like an order/PO with expected delivery
- "credit_note"        → mentions credit, return, refund, negative qtys

GST rules (Australian context):
- "gst_included": true if prices INCLUDE GST (look for "inc GST", "GST inclusive",
  or a single price column with GST already added).
- "gst_included": false if prices are ex GST and GST is shown separately.

Column header rules:
- Include EVERY header you see in the line-item table.
- "Style", "Style No", "Code", "SKU"               → style_code
- "Description", "Item", "Product"                  → product_name
- "Colour", "Color", "Print"                        → colour
- "Size"                                            → size
- "Qty", "Units", "Pcs"                             → quantity
- "Wholesale", "Cost", "Unit Price"                 → cost_ex_gst (or cost_inc_gst if header says "inc GST")
- "RRP", "Retail"                                   → rrp_inc_gst (default for AU) or rrp_ex_gst if explicitly ex GST
- "Barcode", "EAN", "GTIN"                          → barcode
- Anything else                                     → unknown

If the document is multi-page, "table_start_page" is the 1-indexed page where the line-item table first appears.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileContent, fileType, fileName } = await req.json();
    if (!fileContent) {
      return new Response(
        JSON.stringify({ error: "fileContent (base64) is required" }),
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
      model: "google/gemini-2.5-flash", // cheap + multimodal — orientation is small
      temperature: 0.0,
      messages: [
        { role: "system", content: ORIENT_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${fileContent}` } },
            {
              type: "text",
              text: `File: ${fileName || "unknown"}. Return ONLY the orientation JSON described above. No prose.`,
            },
          ],
        },
      ],
    });

    const raw = getContent(data);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (m?.[1] || raw).trim();

    let orientation: Record<string, unknown>;
    try {
      orientation = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Orientation pass returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Defensive defaults so downstream stages can rely on the shape.
    orientation.column_headers = Array.isArray(orientation.column_headers)
      ? orientation.column_headers
      : [];
    orientation.gst_included = orientation.gst_included ?? true;
    orientation.currency = orientation.currency || "AUD";
    orientation.document_type = orientation.document_type || "invoice";
    orientation.table_start_page = Number(orientation.table_start_page) || 1;
    orientation.confidence = Number(orientation.confidence) || 70;

    return new Response(
      JSON.stringify({ orientation, stage: "orientation" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("orient-invoice error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Orientation failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
