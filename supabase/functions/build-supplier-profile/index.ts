import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROFILE_PROMPT = `You are the Sonic Invoices Supplier Invoice Trainer — an expert Australian fashion retail invoice analyst with 15+ years experience.

You have been given MULTIPLE invoices from the SAME supplier. Deeply analyse ALL documents together and build a rich, reusable "Supplier Invoice Profile".

Follow this exact step-by-step reasoning:

1. **Supplier Detection**
   - Extract consistent supplier name, logo clues, address, ABN, email domain, etc.
   - Confirm all files belong to the same supplier.

2. **Layout Analysis**
   - Identify the most common table structure across all invoices (80%+ consistency).
   - Note variations (merged cells, size runs in separate rows, multi-page tables, etc.).

3. **Column & Field Mapping**
   - Build a reliable mapping for every important field: style number, product name, colour, size, unit cost, quantity, line total, barcode, RRP.

4. **Product Name, Colour & Size Rules**
   - How product base names are written.
   - How colours and sizes are attached (one row vs multiple rows).
   - Common abbreviations and how to expand them.

5. **Pricing & GST Rules**
   - Which column is unit cost (ex GST or inc GST).
   - How totals are calculated.
   - Any GST-specific patterns (separate line, percentage, included).

6. **Examples Extraction**
   - Pull 4–6 real examples from different invoices showing raw text → extracted fields.

OUTPUT ONLY VALID JSON — no markdown fences, no explanation:

{
  "supplier": "Exact Supplier Name",
  "profile_version": "YYYY-MM-DD",
  "total_invoices_analysed": number,
  "invoice_layout": "single_main_table | single_main_table_with_size_runs | size_grid_matrix | separate_variant_rows | product_block | multi_page | mixed",
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
  "product_name_cleaning_rules": [
    "Remove anything after last comma if it looks like colour/size",
    "Capitalise first letter of each word"
  ],
  "product_name_rules": "How to extract clean product name — which column, what to strip",
  "colour_rules": "How colour appears — separate column, suffix after dash, embedded in description",
  "variant_rules": "Size runs are usually comma-separated in the Size column. Colours appear before size.",
  "variant_detection_rule": "size_grid_matrix | one_row_per_variant | size_in_description | size_row_below | comma_separated_in_cell",
  "size_system": "numeric_au | alpha | combined | cup | denim | mixed",
  "size_rules": "How sizes appear — column headers, comma-separated, one per row, size grid",
  "abbreviations": {
    "Blk": "Black",
    "Nvy": "Navy",
    "Wht": "White"
  },
  "gst_handling": "inclusive | exclusive | separate_line | not_shown",
  "currency": "AUD",
  "pricing_notes": "Which column is wholesale cost vs RRP, any gotchas",
  "noise_patterns": ["list of common non-product rows seen across invoices e.g. freight, subtotal, page headers"],
  "quirks": ["list of supplier-specific oddities"],
  "examples": [
    {
      "raw_text": "exact text from one invoice row",
      "extracted": {
        "product_name": "Clean Product Name",
        "colour": "Black",
        "size": ["6", "8", "10", "12"],
        "unit_cost": 45.50,
        "quantity": 24
      }
    }
  ],
  "confidence": number_0_to_100,
  "confidence_notes": "Any patterns seen in only some invoices, inconsistencies between invoices",
  "notes_for_future": "Specific instructions for the AI parser to follow for this supplier",
  "extraction_tips": "Step-by-step tips for maximum accuracy on this supplier's invoices"
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
