import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROFILE_PROMPT = `You are an expert Australian fashion retail invoice analyst with 15+ years experience.

You have been given MULTIPLE invoices from the SAME supplier. Your job is to analyse ALL of them together and create a detailed "Supplier Invoice Profile" that will dramatically improve extraction accuracy for future invoices from this supplier.

STEPS (follow exactly):

1. Detect supplier name from headers/logos/footers (consistent across all files).

2. Identify the COMMON layout and table structure across 80%+ of the invoices.

3. Map columns: list every unique column header and what it means (e.g. "Style No.", "Colour/Print", "Size Run", "Unit Cost ex GST", "Pack Qty").

4. Document naming patterns for product_name, colour, size (especially how size runs are written — one row or multiple rows?).

5. Note any supplier-specific quirks (abbreviations, merged cells, GST handling, currency, etc.).

6. Create a clean JSON profile with examples from the real invoices.

OUTPUT ONLY VALID JSON — no markdown fences, no explanation:

{
  "supplier": "Exact Supplier Name",
  "invoice_layout": "row_table | size_grid | product_block | separate_variant_rows | mixed",
  "layout_description": "1-2 sentence description of the typical layout",
  "column_mappings": {
    "style_number": { "header": "Style No.", "position": "Column A or 1", "notes": "" },
    "product_name": { "header": "Description", "position": "Column B or 2", "notes": "" },
    "colour": { "header": "Colour / Print", "position": "Column C or 3", "notes": "" },
    "size": { "header": "Size", "position": "varies", "notes": "how sizes appear" },
    "unit_cost": { "header": "Unit Price ex GST", "position": "Column F", "notes": "" },
    "quantity": { "header": "Qty", "position": "Column G", "notes": "" },
    "rrp": { "header": "RRP or null", "position": "if exists", "notes": "" },
    "line_total": { "header": "Total or null", "position": "if exists", "notes": "" },
    "barcode": { "header": "Barcode/EAN or null", "position": "if exists", "notes": "" }
  },
  "product_name_rules": "How to extract clean product name — which column, what to strip",
  "colour_rules": "How colour appears — separate column, suffix after dash, embedded in description, abbreviation patterns",
  "colour_abbreviations": { "BLK": "Black", "NVY": "Navy" },
  "size_rules": "How sizes appear — column headers, comma-separated, one per row, size grid",
  "variant_detection_rule": "size_grid_matrix | one_row_per_variant | size_in_description | size_row_below",
  "size_system": "numeric_au | alpha | combined | cup | denim | mixed",
  "gst_handling": "inclusive | exclusive | separate_line | not_shown",
  "currency": "AUD",
  "pricing_notes": "Which column is wholesale cost vs RRP, any gotchas",
  "noise_patterns": ["list of common non-product rows seen across invoices"],
  "quirks": ["list of supplier-specific oddities"],
  "examples": [
    {
      "raw_line": "exact text from one invoice row",
      "extracted": {
        "style_code": "ABC123",
        "product_name": "Clean Product Name",
        "colour": "Black",
        "sizes": ["6", "8", "10", "12"],
        "unit_cost": 45.50,
        "quantity": 4
      }
    }
  ],
  "confidence_notes": "Any patterns seen in only some invoices, inconsistencies between invoices",
  "extraction_tips": "Specific instructions for the AI parser to follow for this supplier"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invoices } = await req.json();

    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return new Response(
        JSON.stringify({ error: "No invoices provided. Upload at least 2 invoices." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build multi-image message content
    const contentParts: Array<Record<string, unknown>> = [];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const mimeType = inv.fileType === "pdf" ? "application/pdf" :
        `image/${inv.fileType === "jpg" ? "jpeg" : (inv.fileType || "jpeg")}`;

      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${inv.base64}` },
      });
      contentParts.push({
        type: "text",
        text: `[Invoice ${i + 1} of ${invoices.length}: ${inv.fileName || "unknown"}]`,
      });
    }

    contentParts.push({
      type: "text",
      text: `Analyse all ${invoices.length} invoices above. They are from the SAME supplier. Generate the supplier profile JSON. Return ONLY valid JSON.`,
    });

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: PROFILE_PROMPT },
        { role: "user", content: contentParts },
      ],
      temperature: 0.1,
    });

    const content = getContent(data);
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const profile = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify({ profile, invoices_analysed: invoices.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Profile builder error:", error);
    const status = error instanceof AIGatewayError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Profile generation failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
