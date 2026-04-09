import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Concept-based extraction system prompt ──────────────────
const SYSTEM_PROMPT = `You are an expert document intelligence AI for extracting structured product data from fashion wholesale invoices, packing slips, and delivery dockets.

You do NOT rely on supplier names or brand-specific rules. Instead you analyse document STRUCTURE, LAYOUT, and SEMANTICS to extract data correctly from any supplier.

## STAGE A — DOCUMENT TYPE CLASSIFICATION

Classify the document into one of:
- "tax_invoice" — has line items with pricing (unit cost / wholesale price)
- "statement" — summary of multiple invoices, no individual line items to extract
- "packing_slip" — has items and quantities but NO pricing
- "handwritten_invoice" — handwritten or semi-structured with pricing
- "unknown" — cannot determine

## STAGE B — LAYOUT CLASSIFICATION

Detect the document's structural layout:
- "row_table" — standard table with one product per row, columns for qty/description/price
- "size_grid" — products in rows with size labels as column headers (numeric or alpha) and quantities in cells below
- "size_matrix_inline" — sizes and quantities listed inline or in adjacent cells, mapped positionally
- "product_block" — each product appears as a visual block with a nested size/qty sub-table or options section
- "size_row_below" — product row followed by a separate size breakdown row (e.g. "XS (1) S (2) M (2)")
- "description_embedded" — colour, size, and sometimes style code are embedded in the description text
- "low_structure" — handwritten, loosely formatted, or non-tabular
- "mixed" — multiple layout patterns in the same document

## STAGE C — SEMANTIC FIELD DETECTION

Identify which areas of the document contain:
- **Supplier identity**: company name, logo text, ABN, address in header/footer
- **Document metadata**: invoice number, date, order reference, customer name
- **Line-item zone**: the area containing actual product rows (NOT totals, NOT headers)
- **Product fields**: style code/SKU, product title/description, colour, size, quantity, unit cost, RRP, line total, barcode
- **Noise zones**: subtotals, freight, GST, bank details, payment terms, carton identifiers, page continuations

Key field detection rules:
- **Cost vs RRP**: If two price columns exist, the LOWER value is usually wholesale cost; the HIGHER is RRP. Look for column headers like "SP", "Cost", "Unit Price", "Price (Tax excl.)" for cost. "RRP", "Retail", "Rec. Retail" for retail price.
- **Quantity**: May be in a "Qty", "Units", "Ordered" column, or marked/circled in size grid cells
- **Size**: May be column headers (6,8,10,12), inline text (XS,S,M,L), or embedded in description
- **Colour**: May be a separate column, a suffix after " - " in descriptions, or an abbreviation in the style code

## STAGE D — VARIANT EXTRACTION METHOD DETECTION

Before extracting, determine HOW variants are expressed in this document:

**Method 1: One row per variant**
Each line represents a single size+colour combination. Extract directly.

**Method 2: Size grid matrix**
Size labels appear as column headers. Quantities are in cells below each size.
- Circled, underlined, or highlighted numbers ARE quantities — extract them
- Empty or zero cells mean that size was NOT ordered — skip it
- A "Total Qty" column should confirm the sum of all size quantities
- Create one output row per size with quantity > 0

**Method 3: Product block with nested size/qty table**
A product entry contains a main row (code, name, colour, price) plus a sub-section listing sizes and quantities.
- Parse the sub-section to extract size→quantity pairs
- Colour is usually in the main row or options field
- Create one output row per size

**Method 4: Size breakdown row below product**
Product data on one row, then a following row with patterns like "XS (1) S (2) M (2) L (1)" or "10, 12, 14 / 1, 2, 1"
- Parse the size labels and quantities from the breakdown row
- Create one output row per size

**Method 5: Variants embedded in description**
The product description contains colour and size: "LISA DRESS NAVY XS"
- Split into: base product name, colour token, size token
- Size tokens: XS, S, SM, S/M, M, L, ML, M/L, XL, L/XL, XXL, 2XL, 3XL, O/S, OS, OSFA, One Size, FREE, and numeric 00-30
- Colour tokens: match against known colour vocabulary (see below)

**Method 6: Handwritten / low-structure**
Quantities, descriptions, and prices in loose handwritten format.
- Extract what you can see: qty, description, unit price, total
- Do NOT invent colour or size if not visible
- Set confidence lower (50-70)

## STAGE E — SIZE SYSTEM RECOGNITION

Detect which size system(s) appear in the document:
- Numeric AU/UK: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24
- Numeric US: 0, 2, 4, 6, 8, 10, 12, 14
- Alpha: XXS, XS, S, M, L, XL, XXL, XXXL, 2XL, 3XL
- Combined/dual: S/M, M/L, L/XL, SM, ML
- One size: O/S, OS, One Size, OSFA, FREE
- Cup sizes (swimwear): 8C, 10D, 12DD, 14E
- Denim waist: 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 36

## STAGE F — COLOUR VOCABULARY

Recognise and expand colour abbreviations:
BK/BLK = Black, NY/NVY = Navy, WH/WHT = White, IK = Ink, SW = Seaweed,
KH = Khaki, OLI/OL = Olive, CRE/CR = Cream, LBL = Light Blue, RD = Red,
PK/PNK = Pink, GY/GRY = Grey, BG = Beige, BRN = Brown, COR = Coral,
AQ = Aqua, TQ = Turquoise, MU/MUL = Multi, PR = Print, FL = Floral,
RST = Rust, SAG = Sage, LAV = Lavender, TAN = Tan, PLM = Plum,
MAR = Maroon, CHAR = Charcoal, NAT = Natural, SKY = Sky Blue,
EMR = Emerald, MINT = Mint, PEA = Peach, LIL = Lilac,
TER = Terracotta, OCH = Ochre, BUR = Burgundy, FUC = Fuchsia, MAU = Mauve,
SNW = Snow, OATML = Oatmeal, IND = Indigo, TEA = Teal, ROS = Rose,
CHA = Chambray, DEN = Denim, STO = Stone, SAN = Sand, ECRU = Ecru

Detect colour from (priority order):
1. Explicit colour column
2. Description suffix after " - " (e.g. "Palazzo Pant - White")
3. Description suffix matching known colour after last space
4. Style code suffix matching abbreviation (e.g. "-NVY", "_BLK")
5. Options/notes field

## NOISE FILTERING

NEVER include these as products:
- Freight / Shipping / Delivery charges
- GST / Tax / VAT lines
- Subtotal / Total / Grand Total lines
- Discount lines
- ASN / Consignment / Carton references
- Bank details / Payment terms
- Customer address blocks
- "Continued on next page" / page markers
- Empty rows / repeated column headers
- Story/collection/season headers that contain no product data

Identify product rows by: having a descriptive title (3+ chars, not just a number), and at least one of: quantity, price, or style code.

## CONFIDENCE SCORING

Score each extracted row 0-100:
- Has product title with 3+ meaningful characters: +20
- Has valid unit_cost > 0: +20
- Has recognisable size value: +15
- Has colour: +15
- Has style code / SKU: +15
- Has quantity > 0: +15
- Deductions: missing price -20, ambiguous text -10, handwritten uncertainty -15, uncertain quantity -10

## OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no explanation):

{
  "parsing_plan": {
    "document_type": "tax_invoice" | "packing_slip" | "handwritten_invoice" | "statement" | "unknown",
    "layout_type": "<one of the layout types from Stage B>",
    "variant_method": "one_row_per_variant" | "size_grid_matrix" | "product_block_nested" | "size_row_below" | "description_embedded" | "handwritten" | "none",
    "line_item_zone": "description of where the product rows are located (e.g. 'rows 5-45 of the main table')",
    "quantity_field": "description of where/how quantity is expressed (e.g. 'Qty column', 'circled numbers in size grid', 'inline after size labels')",
    "cost_field": "description of which field contains wholesale cost (e.g. 'Unit Price column', 'SP column — not RRP')",
    "grouping_required": true | false,
    "grouping_reason": "why grouping is or isn't needed (e.g. 'multiple size rows share the same style code')",
    "expected_review_level": "low" | "medium" | "high",
    "review_reason": "why this review level (e.g. 'clean structured table, high confidence' or 'handwritten, many uncertain quantities')",
    "strategy_explanation": "1-2 sentence explanation of the overall extraction approach chosen"
  },
  "supplier": "detected supplier name",
  "invoice_number": "if visible",
  "currency": "AUD" or detected currency,
  "detected_size_system": "numeric_au" | "alpha" | "combined" | "cup" | "denim" | "mixed" | "none",
  "detected_fields": ["list", "of", "field", "names", "found"],
  "products": [
    {
      "style_code": "raw style/article/product code",
      "product_title": "clean base product name WITHOUT colour or size",
      "colour": "expanded colour name",
      "size": "size value",
      "quantity": number,
      "unit_cost": number or null,
      "rrp": number or null,
      "line_total": number or null,
      "barcode": "if visible",
      "product_type": "e.g. One Piece, Dress, Pant, Top",
      "confidence": 0-100,
      "parse_notes": "any issues, ambiguity, or extraction strategy used",
      "extraction_reason": "brief explanation of why this row was identified as a product"
    }
  ],
  "rejected_rows": [
    {
      "raw_text": "the original text of the rejected row",
      "rejection_reason": "why this was not a product"
    }
  ]
}

CRITICAL RULES:
- Create ONE output row per size+colour variant where quantity > 0
- product_title must be the CLEAN base name without colour or size appended
- Do NOT hallucinate data that is not visible in the document
- If cost is missing, set unit_cost to null — do not guess
- For packing slips: set unit_cost and rrp to null, focus on qty extraction
- For handwritten documents: lower confidence, flag uncertain readings`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileContent, fileName, fileType, customInstructions, supplierName, forceMode, templateHint } = await req.json();

    if (!fileContent) {
      return new Response(JSON.stringify({ error: "No file content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    let systemPrompt = SYSTEM_PROMPT;

    // Force mode overrides
    if (forceMode === "packing_slip") {
      systemPrompt += `\n\nIMPORTANT: The user has confirmed this is a PACKING SLIP. Set document_type to "packing_slip". Do NOT extract prices — set unit_cost and rrp to null.`;
    } else if (forceMode === "invoice") {
      systemPrompt += `\n\nIMPORTANT: The user has confirmed this is an INVOICE. Set document_type to "tax_invoice". Extract prices.`;
    } else if (forceMode === "handwritten") {
      systemPrompt += `\n\nIMPORTANT: The user has confirmed this is a HANDWRITTEN INVOICE. Set document_type to "handwritten_invoice". Extract carefully, flag low confidence, do not invent variants.`;
    }

    // Template hint from learned patterns
    if (templateHint) {
      systemPrompt += `\n\n## LEARNED TEMPLATE HINT (from previous successful parses of this supplier)
This supplier has been parsed before. Use these hints to guide extraction:
- Layout type previously detected: ${templateHint.layoutType || "unknown"}
- Variant method previously used: ${templateHint.variantMethod || "unknown"}
- Size system detected: ${templateHint.sizeSystem || "unknown"}
- Fields detected previously: ${(templateHint.detectedFields || []).join(", ") || "unknown"}
${templateHint.corrections?.length ? `- Merchant corrections to apply:\n${templateHint.corrections.map((c: string) => `  • ${c}`).join("\n")}` : ""}
${templateHint.customInstructions ? `- Custom parsing instructions: ${templateHint.customInstructions}` : ""}
Use this as guidance but verify against the actual document structure. If the document layout differs, override the hints.`;
    }

    if (customInstructions) {
      systemPrompt += `\n\n## USER CUSTOM INSTRUCTIONS (follow these exactly):\n${customInstructions}`;
    }
    if (supplierName) {
      systemPrompt += `\nKnown supplier: ${supplierName}`;
    }

    let messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;

    if (isImage || isPdf) {
      const mimeType = isImage
        ? `image/${fileType === "jpg" ? "jpeg" : fileType}`
        : "application/pdf";

      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${fileContent}`,
              },
            },
            {
              type: "text",
              text: "Analyse this document's structure and layout. Classify the document type, detect the layout pattern, identify the variant expression method, then extract ALL products with full variant breakdown. Create one row per size/colour variant. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyse this document's structure and layout. Classify the document type, detect the layout pattern, identify the variant expression method, then extract ALL products with full variant breakdown. Create one row per size/colour variant. Return JSON only.\n\nDocument content:\n${fileContent}`,
        },
      ];
    }

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages,
      temperature: 0.1,
    });
    const content = getContent(data);

    // Extract JSON from response
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const parsed = JSON.parse(jsonStr);

    const docType = parsed.document_type || (forceMode || "tax_invoice");
    const layoutType = parsed.layout_type || "unknown";
    const variantMethod = parsed.variant_method || "unknown";
    const detectedFields = parsed.detected_fields || [];
    const detectedSizeSystem = parsed.detected_size_system || "none";

    const rawProducts: Array<Record<string, unknown>> = parsed.products || [];
    const rejectedRows: Array<Record<string, unknown>> = parsed.rejected_rows || [];

    // Server-side noise filter
    const filtered = rawProducts.filter((p: Record<string, unknown>) => {
      const title = String(p.product_title || p.style_description || p.name || "").toLowerCase();
      const code = String(p.style_code || p.sku || "");
      if (!title && !code) return false;
      if (/^(total|subtotal|sub total|freight|shipping|gst|tax|delivery|discount)$/i.test(title)) return false;
      if (/^carton\s/i.test(title) || /^carton\s/i.test(code)) return false;
      return true;
    });

    if (docType === "packing_slip") {
      return new Response(JSON.stringify({
        document_type: "packing_slip",
        layout_type: layoutType,
        variant_method: variantMethod,
        detected_fields: detectedFields,
        detected_size_system: detectedSizeSystem,
        confidence: parsed.confidence || 85,
        supplier: parsed.supplier || supplierName || "",
        supplier_order_number: parsed.supplier_order_number || parsed.invoice_number || "",
        rejected_rows: rejectedRows,
        products: filtered.map((p: Record<string, unknown>) => ({
          style_code: p.style_code || p.sku || "",
          colour_code: p.colour || "",
          style_description: p.product_title || p.name || "",
          size: p.size || "",
          quantity: Number(p.quantity) || 0,
          barcode: p.barcode || "",
          confidence: Number(p.confidence) || 70,
          parse_notes: p.parse_notes || "",
          extraction_reason: p.extraction_reason || "",
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invoice response
    const normalizedProducts = filtered.map((p: Record<string, unknown>) => ({
      name: p.product_title || p.name || "",
      brand: parsed.supplier || supplierName || String(p.brand || ""),
      sku: p.style_code || p.sku || "",
      barcode: p.barcode || "",
      type: p.product_type || p.type || "",
      colour: p.colour || "",
      size: p.size || "",
      qty: Number(p.quantity || p.qty) || 0,
      cost: Number(p.unit_cost || p.cost) || 0,
      rrp: Number(p.rrp) || 0,
      _confidence: Number(p.confidence) || 70,
      _parseNotes: p.parse_notes || "",
      _lineTotal: Number(p.line_total) || 0,
      _extractionReason: p.extraction_reason || "",
    }));

    return new Response(JSON.stringify({
      document_type: docType,
      layout_type: layoutType,
      variant_method: variantMethod,
      detected_fields: detectedFields,
      detected_size_system: detectedSizeSystem,
      supplier: parsed.supplier || supplierName || "",
      invoice_number: parsed.invoice_number || "",
      currency: parsed.currency || "AUD",
      rejected_rows: rejectedRows,
      products: normalizedProducts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Parse invoice error:", error);
    const status = error instanceof AIGatewayError ? error.status : 500;
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
