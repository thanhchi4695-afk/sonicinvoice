// ──────────────────────────────────────────────────────────────
// Universal Invoice Pattern Classifier
//
// Stage 0 of the Supplier Brain — runs BEFORE extraction. Returns:
//   • detected_pattern   — one of A..H (95% AU wholesale coverage)
//   • column_map         — header label → standard field
//   • gst_treatment      — inc | ex | nz_inc | unknown
//   • has_rrp, sku_format, size_in_sku, colour_in_name
//   • confidence         — 0..100  (<60 means trigger guided wizard)
//
// Cheap & fast: gemini-2.5-flash, single image pass, no extraction.
// ──────────────────────────────────────────────────────────────

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `You are the Universal Invoice Pattern Classifier of a wholesale-fashion extraction pipeline.
Return STRICT JSON only — no markdown fences, no commentary.

Choose ONE detected_pattern from the 8 universal patterns below:

A — FLAT_ROWS_EXPLICIT_COLUMNS
   One product per row. Separate columns for name, SKU, colour, size, cost, qty.
   Examples: Liquid Brands, Sunnylife.

B — PARENT_CHILD_SIZE_COLUMNS
   Product name on one row; sizes (8,10,12,14,16,18,20,22,24) appear as column
   headers across the row. One price applies to all sizes.
   Examples: Jantzen / Skye Group, Sea Level, Sunseeker, Baku.

C — SKU_PER_SIZE_ROWS
   Every size is a separate row. Same base SKU repeated with size suffix
   (e.g. KKRF04-7, KKRF04-8, KKRF04-9).
   Examples: Sundaise.

D — NAME_EMBEDDED_SIZE_COLOUR
   No separate size/colour columns — both appear inside the product name string,
   e.g. "- Large -", "- Black -", "(XL)", "S7", "S8".
   Examples: SomerSide.

E — CODE_ONLY_ROWS
   SKU/code is used as both the identifier AND the product name.
   No human-readable description.
   Examples: Isabella Wholesale (RA239, DZ0566).

F — MULTI_INVOICE_PDF
   One file contains multiple separate TAX INVOICE headers / numbers / totals.
   Examples: Jantzen PDF with 8 invoices.

G — ECOMMERCE_RECEIPT
   Looks like a consumer receipt: "Thank you for your order", payment method,
   discount code, RRP visible. Examples: Sun Soul.

H — HANDWRITTEN_LOW_STRUCTURE
   Scanned handwritten or minimal format. No consistent columns. Low OCR.

Return JSON of this exact shape:

{
  "detected_pattern": "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H",
  "supplier_name": "best-effort exact supplier name from header",
  "supplier_abn": null | "11 222 333 444",
  "column_map": {
    "<EXACT header text as printed>": "product_name" | "style_code" | "colour" |
       "size" | "cost_ex_gst" | "cost_inc_gst" | "rrp_inc_gst" | "quantity" |
       "barcode" | "description" | "unknown"
  },
  "gst_treatment": "inc" | "ex" | "nz_inc" | "unknown",
  "has_rrp": true | false,
  "sku_format": "alphanumeric" | "numeric" | "barcode_13" | "with_size_suffix" | "unknown",
  "size_in_sku": true | false,
  "colour_in_name": true | false,
  "confidence": 0-100,
  "reasoning": "1-2 short sentences explaining the pattern choice"
}

Detection guidance:
- If you see numeric size headers (8,10,12,14...) across columns → Pattern B.
- If the same base SKU repeats with -7,-8,-9 suffixes → Pattern C.
- If product name contains "- Large -" or "(XL)" or "S7" → Pattern D.
- If "Item" and "Code" columns are identical and there's no description → Pattern E.
- If you see "TAX INVOICE" appearing two or more times with different invoice numbers → Pattern F.
- If you see "Thank you for your order" or a discount code line → Pattern G.
- If text is handwritten or alignment is broken → Pattern H.
- Otherwise → Pattern A.

Field header variations to recognise:
  product_name : Description, Item, Product, Style Name, Style Description, Article, Title, Goods Description
  style_code   : Code, Item No, Style, Style Code, SKU, Article No, Ref, Part No
  colour       : Colour, Color, Col, Colourway, Print, Variant, Finish
  size         : Size, Sizes, Option
  cost_ex_gst  : Wholesale, Cost, Unit Price, Buy Price, Nett Price, Trade Price
  rrp_inc_gst  : RRP, Retail, Recommended Retail Price, MSRP
  quantity     : Qty, Quantity, Units, Ordered, Pcs, No., Count
  barcode      : Barcode, EAN, GTIN  (12-13 digits)

GST rules (Australia):
- "GST" column shown per row → prices are ex-GST → "ex"
- GST only at invoice total → all line prices ex-GST → "ex"
- "inc GST" / "GST inclusive" in header → "inc"
- NZ address or NZ GST number (100-xxx-xxx) → "nz_inc" (15% not 10%)`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { fileContent, fileType, fileName } = await req.json();
    if (!fileContent) {
      return new Response(JSON.stringify({ error: "fileContent (base64) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${fileContent}` } },
            { type: "text", text: `File: ${fileName || "unknown"}. Return ONLY the classification JSON.` },
          ],
        },
      ],
    });

    const raw = getContent(data);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (m?.[1] || raw).trim();

    let classification: Record<string, unknown>;
    try {
      classification = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Classifier returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Defensive defaults
    classification.detected_pattern = String(classification.detected_pattern || "A").toUpperCase().slice(0, 1);
    if (!"ABCDEFGH".includes(classification.detected_pattern as string)) classification.detected_pattern = "A";
    classification.column_map = classification.column_map || {};
    classification.gst_treatment = classification.gst_treatment || "unknown";
    classification.confidence = Number(classification.confidence) || 50;
    classification.has_rrp = !!classification.has_rrp;
    classification.size_in_sku = !!classification.size_in_sku;
    classification.colour_in_name = !!classification.colour_in_name;

    return new Response(JSON.stringify({ classification, stage: "classify" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("classify-invoice-pattern error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Classification failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
