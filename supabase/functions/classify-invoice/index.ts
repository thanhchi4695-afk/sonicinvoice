// ───────────────────────────────────────────────────────────────
// Agent 2 — Stage 1: ORIENTATION / CLASSIFIER
// Looks at the document and answers metadata-only questions.
// Does NOT extract any product data.
// ───────────────────────────────────────────────────────────────
import { getContent, AIGatewayError } from "../_shared/ai-gateway.ts";
import { callAIForJob } from "../_shared/model-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an invoice classifier. Look at this document and answer ONLY the questions below in strict JSON. Do not extract any product data yet.

Return STRICT JSON — no markdown fences, no commentary:

{
  "supplier_name": string | null,
  "document_type": "invoice" | "packing_slip" | "order_confirmation" | "credit_note" | "receipt" | "unknown",
  "currency": "AUD" | "NZD" | "USD" | "GBP" | string,
  "gst_treatment": "excluded_per_line" | "included_per_line" | "at_total_only" | "no_gst" | "unknown",
  "layout_pattern": "A_flat_rows" | "B_parent_child_size_columns" | "C_sku_per_size_rows" | "D_name_embedded_variants" | "E_code_only_rows" | "F_multi_invoice_pdf" | "G_ecommerce_receipt" | "H_handwritten_low_structure",
  "has_rrp": boolean,
  "column_headers": [
    { "label": string, "maps_to": "product_name" | "style_code" | "colour" | "size" | "cost_ex_gst" | "cost_inc_gst" | "rrp_inc_gst" | "rrp_ex_gst" | "quantity" | "barcode" | "description" | "unknown" }
  ],
  "confidence": number
}

Layout pattern guide:
- A_flat_rows: one product per row, all info on row.
- B_parent_child_size_columns: parent product row + size labels as COLUMN headers (e.g. 6 8 10 12 14 or XS S M L) with quantities in cells.
- C_sku_per_size_rows: one row per (style + size) combo, each with its own SKU/barcode.
- D_name_embedded_variants: colour/size embedded inside the product name/description text.
- E_code_only_rows: only style codes + qty, no descriptive name.
- F_multi_invoice_pdf: multiple distinct invoices concatenated in one PDF.
- G_ecommerce_receipt: Shopify/Squarespace/etc. order/receipt format.
- H_handwritten_low_structure: handwritten or photographed loose-format docket.

GST guide:
- excluded_per_line: line costs are ex-GST; GST shown only at footer.
- included_per_line: line costs already include GST.
- at_total_only: no per-line GST visible; total has GST line.
- no_gst: no GST anywhere (export, overseas, etc.).

confidence: 0–100. Be honest; if you can't tell, return null/unknown and a low score.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { file_base64, filename, fileType } = await req.json();
    if (!file_base64 || !filename) {
      return json({ error: "file_base64 and filename are required" }, 400);
    }

    const ext = String(fileType || filename.split(".").pop() || "jpeg").toLowerCase();
    const mime =
      ext === "pdf" ? "application/pdf" :
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      ext === "csv" ? "text/csv" :
      ext === "xlsx" || ext === "xls" ? "application/vnd.ms-excel" :
      `image/${ext === "jpg" ? "jpeg" : ext}`;

    // For text-ish files (csv/xlsx), include a small base64-decoded preview.
    let textPreview = "";
    if (ext === "csv") {
      try { textPreview = atob(file_base64).slice(0, 4000); } catch { /* ignore */ }
    }

    const userContent: Array<Record<string, unknown>> = [];
    if (textPreview) {
      userContent.push({ type: "text", text: `File: ${filename}\n\nFile content (first 4000 chars):\n${textPreview}\n\nClassify per the schema. JSON only.` });
    } else {
      userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${file_base64}` } });
      userContent.push({ type: "text", text: `File: ${filename}\nClassify this document per the schema above. JSON only.` });
    }

    const data = await callAIForJob("invoice.classify", {
      temperature: 0.0,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = getContent(data);
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (m?.[1] || raw).trim();

    let classification: Record<string, unknown>;
    try {
      classification = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Stage 1 returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Normalise / defaults
    classification.supplier_name = (classification.supplier_name as string) || null;
    classification.document_type = (classification.document_type as string) || "unknown";
    classification.currency = (classification.currency as string) || "AUD";
    classification.gst_treatment = (classification.gst_treatment as string) || "unknown";
    classification.layout_pattern = (classification.layout_pattern as string) || "A_flat_rows";
    classification.has_rrp = !!classification.has_rrp;
    classification.column_headers = Array.isArray(classification.column_headers) ? classification.column_headers : [];
    classification.confidence = Number(classification.confidence) || 70;

    return new Response(
      JSON.stringify({ classification, stage: "orientation" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("classify-invoice error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : "Classification failed" }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
