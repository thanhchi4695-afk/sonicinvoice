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

## STAGE B2 — LINE-ITEM TABLE BOUNDARY DETECTION (CRITICAL)

Before extracting any products, you MUST identify the exact boundaries of the line-item table:

1. **Header zone** (IGNORE): Company logo, supplier name, ABN, address, invoice number, date, customer details. This is NOT product data.
2. **Line-item zone** (EXTRACT FROM HERE): The rectangular region containing the product table. It typically:
   - Starts after column headers like "Style", "Description", "Qty", "Price", "Total"
   - Contains multiple rows of product data
   - Each row usually begins with a style code / SKU in the leftmost data column
3. **Footer zone** (IGNORE): Subtotals, GST, Total Incl. GST, payment terms, bank details.

**CRITICAL**: Only extract products from the line-item zone. NEVER treat header text, address blocks, or footer totals as products.

## STAGE B3 — ROW SEGMENTATION BY STYLE CODE ANCHORS (CRITICAL FOR MULTI-PRODUCT INVOICES)

This is the MOST IMPORTANT stage for invoices with many products. You MUST segment the line-item table into individual product rows BEFORE extracting data.

**Step 1: Scan for style code anchors**
Look for a vertical sequence of style codes / SKU codes in the left column of the line-item table. Common patterns:
- Alphanumeric codes like CF08381, CF08446, CF08448, AB1234, ST-2045
- Codes that repeat a consistent format (same prefix, similar length)
- Each style code marks the START of a new product row

**Step 2: Count all anchors**
If you see style codes CF08381, CF08446, CF08448, CF08449, CF08450 in the left column, that means there are AT LEAST 5 product rows. You MUST extract ALL of them.

**Step 3: Segment one row per style code**
Each product row spans from one style code anchor to the next. A single row may include:
- The style code itself
- A product description / title (same row or adjacent)
- A colour / range name
- A size grid or size list with quantities
- A unit price and/or line total

**Step 4: Extract EVERY row independently**
Do NOT stop after the first row. Do NOT collapse multiple rows into one product. Each style code = one product family. Then within each product family, expand size variants.

**Step 5: Row-level debug output**
For each detected row, record in the output:
- row_index: sequential number (0, 1, 2, ...)
- anchor_code: the style code that started this row
- row_confidence: 0-100 confidence for this specific row
- row_y_start: normalized 0-1 vertical position where this row starts on the page
- row_y_end: normalized 0-1 vertical position where this row ends

## STAGE C — SEMANTIC FIELD DETECTION

Identify which areas of the document contain:
- **Supplier identity**: company name, logo text, ABN, address in header/footer
- **Document metadata**: invoice number, date, order reference, customer name
- **Line-item zone**: the area containing actual product rows (NOT totals, NOT headers)
- **Product fields**: style code/SKU, product title/description, colour, size, quantity, unit cost, RRP, line total, barcode
- **Noise zones**: subtotals, freight, GST, bank details, payment terms, carton identifiers, page continuations

Key field detection rules:
- **Cost vs RRP**: If two price columns exist, the LOWER value is usually wholesale cost; the HIGHER is RRP. Look for column headers like "SP", "Cost", "Unit Price", "Price (Tax excl.)" for cost. "RRP", "Retail", "Rec. Retail" for retail price.
- **CRITICAL COST RULE**: NEVER use RRP as cost. If only one price column exists and it's labelled "RRP" or "Retail", set unit_cost to null. Only use wholesale/cost/unit price columns.
- **Cost derivation**: If line_total and quantity are both available but unit_cost is missing, derive unit_cost = line_total / quantity. Always verify: unit_cost × quantity should approximately equal line_total (within 2% tolerance for rounding).
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
Product data on one row, then a following row with patterns like "XS (1) S (2) M (2)" or "10, 12, 14 / 1, 2, 1"
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

## STAGE G — PRODUCT GROUPING

After extraction, identify which rows should be grouped as variants of the same product:
- Rows with the SAME style_code AND colour but DIFFERENT sizes → variants of one product
- Rows with the SAME style_code but DIFFERENT colours → separate products (one per colour)
- Set "group_key" to "style_code|colour" for grouping

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
- "Total Units", "Total Excl. GST", "GST Amount", "Total Incl. GST" — these are FOOTER TOTALS, not products

Identify product rows by: having a descriptive title (3+ chars, not just a number), and at least one of: quantity, price, or style code.

## CONFIDENCE SCORING

Score each extracted row 0-100:
- Has product title with 3+ meaningful characters: +20
- Has valid unit_cost > 0 (NOT derived from RRP): +20
- Has recognisable size value: +15
- Has colour: +15
- Has style code / SKU: +15
- Has quantity > 0: +15
- Math cross-check passes (unit_cost × qty ≈ line_total): +5
- Deductions: missing price -20, ambiguous text -10, handwritten uncertainty -15, uncertain quantity -10, cost derived from line_total -5

## OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no explanation):

{
  "parsing_plan": {
    "document_type": "tax_invoice" | "packing_slip" | "handwritten_invoice" | "statement" | "unknown",
    "layout_type": "<one of the layout types from Stage B>",
    "variant_method": "one_row_per_variant" | "size_grid_matrix" | "product_block_nested" | "size_row_below" | "description_embedded" | "handwritten" | "none",
    "size_system": "numeric_au" | "numeric_us" | "alpha" | "combined" | "cup" | "denim" | "one_size" | "mixed" | "none",
    "line_item_zone": "description of where the product rows are located",
    "quantity_field": "description of where/how quantity is expressed",
    "cost_field": "description of which field contains wholesale cost",
    "cost_derivation": "direct" | "from_line_total" | "missing",
    "grouping_required": true | false,
    "grouping_reason": "why grouping is or isn't needed",
    "total_products_expected": number,
    "total_variants_expected": number,
    "row_anchors_detected": ["CF08381", "CF08446", "CF08448"],
    "row_count": number,
    "expected_review_level": "low" | "medium" | "high",
    "review_reason": "why this review level",
    "strategy_explanation": "1-2 sentence explanation of the overall extraction approach chosen"
  },
  "supplier": "detected supplier name",
  "invoice_number": "if visible",
  "invoice_date": "YYYY-MM-DD if visible",
  "due_date": "YYYY-MM-DD if visible",
  "currency": "AUD" or detected currency,
  "subtotal": number or null,
  "gst": number or null,
  "total": number or null,
  "detected_size_system": "numeric_au" | "alpha" | "combined" | "cup" | "denim" | "mixed" | "none",
  "detected_fields": ["list", "of", "field", "names", "found"],
  "products": [
    {
      "row_index": 0,
      "anchor_code": "CF08381",
      "row_y_start": 0.25,
      "row_y_end": 0.32,
      "row_confidence": 92,
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
      "group_key": "style_code|colour for grouping variants",
      "confidence": 0-100,
      "parse_notes": "any issues, ambiguity, or extraction strategy used",
      "extraction_reason": "brief explanation of why this row was identified as a product",
      "cost_source": "direct" | "derived_from_line_total" | "missing",
      "source_regions": {
        "title": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. description column" },
        "sku": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. style code column" },
        "colour": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. colour column" },
        "size": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. size grid column" },
        "quantity": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. qty column" },
        "cost": { "page": 1, "y_position": 0.0-1.0, "extraction_method": "e.g. unit price column" }
      }
    }
  ],
  "rejected_rows": [
    {
      "raw_text": "the original text of the rejected row",
      "rejection_reason": "why this was not a product"
    }
  ]
}

For source_regions: y_position is a normalized 0-1 value indicating the vertical position on the page where this field's data was found (0 = top, 1 = bottom). page is 1-indexed. Only include fields that were actually detected.

CRITICAL RULES:
- SCAN THE ENTIRE LINE-ITEM TABLE. If you see 10 style codes, you MUST return products from ALL 10 rows.
- Do NOT stop after the first product row. Do NOT return only one item when the table has many.
- Create ONE output row per size+colour variant where quantity > 0
- product_title must be the CLEAN base name without colour or size appended
- Do NOT hallucinate data that is not visible in the document
- If cost is missing, set unit_cost to null — do not guess
- NEVER use RRP as cost — if only RRP is visible, set unit_cost to null
- If line_total and quantity exist but unit_cost is missing, DERIVE unit_cost = line_total / quantity and set cost_source to "derived_from_line_total"
- For packing slips: set unit_cost and rrp to null, focus on qty extraction
- For handwritten documents: lower confidence, flag uncertain readings
- Always set group_key so the client can group variants correctly`;

// ── Server-side post-AI validation ──────────────────────────
function crossValidateProducts(products: Record<string, unknown>[]): Record<string, unknown>[] {
  return products.map(p => {
    const unitCost = Number(p.unit_cost) || 0;
    const qty = Number(p.quantity) || 0;
    const lineTotal = Number(p.line_total) || 0;
    const rrp = Number(p.rrp) || 0;
    let confidence = Number(p.confidence) || 50;
    const notes: string[] = [String(p.parse_notes || "")].filter(Boolean);
    let costSource = String(p.cost_source || "direct");

    // Rule 1: Derive cost from line_total if missing
    if (unitCost === 0 && lineTotal > 0 && qty > 0) {
      const derived = Math.round((lineTotal / qty) * 100) / 100;
      p.unit_cost = derived;
      costSource = "derived_from_line_total";
      notes.push(`Cost derived: $${lineTotal} / ${qty} = $${derived}`);
      confidence = Math.max(0, confidence - 5);
    }

    // Rule 2: Math cross-check
    if (unitCost > 0 && qty > 0 && lineTotal > 0) {
      const expected = unitCost * qty;
      const tolerance = expected * 0.02;
      if (Math.abs(expected - lineTotal) > tolerance && Math.abs(expected - lineTotal) > 1) {
        notes.push(`Math mismatch: ${unitCost} × ${qty} = ${expected.toFixed(2)}, but line_total = ${lineTotal.toFixed(2)}`);
        confidence = Math.max(0, confidence - 10);
      }
    }

    // Rule 3: Cost should be less than RRP
    const finalCost = Number(p.unit_cost) || 0;
    if (finalCost > 0 && rrp > 0 && finalCost >= rrp) {
      notes.push(`Warning: cost ($${finalCost}) >= RRP ($${rrp}) — possible column swap`);
      confidence = Math.max(0, confidence - 15);
    }

    // Rule 4: Suspiciously high cost (> $500 for fashion)
    if (finalCost > 500) {
      notes.push(`Warning: cost ($${finalCost}) unusually high — verify manually`);
      confidence = Math.max(0, confidence - 5);
    }

    // Rule 5: Zero quantity
    if (qty <= 0) {
      notes.push("Zero or missing quantity");
      confidence = Math.max(0, confidence - 10);
    }

    // Rule 6: Generate group_key if missing
    if (!p.group_key) {
      const styleCode = String(p.style_code || "");
      const colour = String(p.colour || "");
      p.group_key = styleCode ? `${styleCode}|${colour}` : "";
    }

    p.confidence = Math.min(100, Math.max(0, confidence));
    p.parse_notes = notes.filter(Boolean).join("; ");
    p.cost_source = costSource;
    return p;
  });
}

// ── Server-side noise filter ──────────────────────────────
function filterNoise(products: Record<string, unknown>[]): { kept: Record<string, unknown>[]; rejected: Record<string, unknown>[] } {
  const kept: Record<string, unknown>[] = [];
  const rejected: Record<string, unknown>[] = [];

  for (const p of products) {
    const title = String(p.product_title || p.style_description || p.name || "").trim().toLowerCase();
    const code = String(p.style_code || p.sku || "").trim();

    if (!title && !code) {
      rejected.push({ raw_text: JSON.stringify(p), rejection_reason: "Empty title and code" });
      continue;
    }
    if (/^(total|subtotal|sub total|freight|shipping|gst|tax|delivery|discount|amount due|balance|payment|deposit)$/i.test(title)) {
      rejected.push({ raw_text: title, rejection_reason: `Noise term: "${title}"` });
      continue;
    }
    if (/^carton\s/i.test(title) || /^carton\s/i.test(code)) {
      rejected.push({ raw_text: title || code, rejection_reason: "Carton reference" });
      continue;
    }
    if (/^\d+[.,]\d{2}$/.test(title)) {
      rejected.push({ raw_text: title, rejection_reason: "Title is a price value" });
      continue;
    }
    kept.push(p);
  }

  return { kept, rejected };
}

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

    // Template hint from learned memory patterns
    if (templateHint) {
      systemPrompt += `\n\n## LEARNED MEMORY (from ${templateHint.totalParses || 0} previous parses of this supplier)
This supplier has been parsed before. The system has learned these patterns — use them to improve extraction accuracy.

### Document structure learned:
- Layout type: ${templateHint.layoutType || "unknown"}
- Variant method: ${templateHint.variantMethod || "unknown"}
- Size system: ${templateHint.sizeSystem || "unknown"}
- Table headers detected: ${(templateHint.tableHeaders || []).join(", ") || "unknown"}
- Line-item zone: ${templateHint.lineItemZone || "unknown"}
- Cost field: ${templateHint.costFieldRule || "unknown"}
- Quantity field: ${templateHint.quantityFieldRule || "unknown"}
- Grouping required: ${templateHint.groupingRequired ?? "unknown"}
${templateHint.confidenceBoost > 0 ? `- Confidence boost earned: +${templateHint.confidenceBoost} (add this to each row's confidence score)` : ""}`;

      if (templateHint.noiseExclusions?.length) {
        systemPrompt += `\n\n### Learned noise patterns (ALWAYS reject these):
${templateHint.noiseExclusions.map((n: string) => `• ${n}`).join("\n")}`;
      }

      if (templateHint.corrections?.length) {
        systemPrompt += `\n\n### Learned field corrections (APPLY these automatically):
${templateHint.corrections.map((c: string) => `• ${c}`).join("\n")}`;
      }

      if (templateHint.groupingRules?.length) {
        systemPrompt += `\n\n### Learned grouping rules:
${templateHint.groupingRules.map((g: string) => `• ${g}`).join("\n")}`;
      }

      systemPrompt += `\n\nUse this learned memory as primary guidance. Verify against the actual document structure — if the layout has changed significantly, override the hints and note the difference.`;
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
              text: "Analyse this document. FIRST scan the entire line-item table and identify ALL style code anchors (e.g. CF08381, CF08446, etc.) — list them in row_anchors_detected. Then extract EVERY product row, one per style code anchor, expanding size variants. Do NOT stop after the first row. If you see 5 style codes, return products from all 5. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyse this document. FIRST scan the entire line-item table and identify ALL style code anchors — list them in row_anchors_detected. Then extract EVERY product row, expanding size variants. Do NOT stop after the first row. Return JSON only.\n\nDocument content:\n${fileContent}`,
        },
      ];
    }

    // Use Pro model for complex documents (PDFs, images), Flash for text
    const model = (isPdf || isImage) ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";

    const data = await callAI({
      model,
      messages,
      temperature: 0.1,
    });
    const content = getContent(data);

    // Extract JSON from response
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const parsed = JSON.parse(jsonStr);

    const parsingPlan = parsed.parsing_plan || {};
    const docType = parsingPlan.document_type || parsed.document_type || (forceMode || "tax_invoice");
    const layoutType = parsingPlan.layout_type || parsed.layout_type || "unknown";
    const variantMethod = parsingPlan.variant_method || parsed.variant_method || "unknown";
    const detectedFields = parsed.detected_fields || [];
    const detectedSizeSystem = parsed.detected_size_system || parsingPlan.size_system || "none";

    const rawProducts: Array<Record<string, unknown>> = parsed.products || [];
    const aiRejected: Array<Record<string, unknown>> = parsed.rejected_rows || [];

    // Server-side noise filter
    const { kept: filtered, rejected: noiseRejected } = filterNoise(rawProducts);
    const allRejected = [...aiRejected, ...noiseRejected];

    // Server-side cross-validation
    const validated = crossValidateProducts(filtered);

    if (docType === "packing_slip") {
      return new Response(JSON.stringify({
        document_type: "packing_slip",
        layout_type: layoutType,
        variant_method: variantMethod,
        parsing_plan: parsingPlan,
        detected_fields: detectedFields,
        detected_size_system: detectedSizeSystem,
        confidence: parsed.confidence || 85,
        supplier: parsed.supplier || supplierName || "",
        supplier_order_number: parsed.supplier_order_number || parsed.invoice_number || "",
        invoice_date: parsed.invoice_date || "",
        rejected_rows: allRejected,
        products: validated.map((p: Record<string, unknown>) => ({
          style_code: p.style_code || p.sku || "",
          colour_code: p.colour || "",
          style_description: p.product_title || p.name || "",
          size: p.size || "",
          quantity: Number(p.quantity) || 0,
          barcode: p.barcode || "",
          group_key: p.group_key || "",
          confidence: Number(p.confidence) || 70,
          parse_notes: p.parse_notes || "",
          extraction_reason: p.extraction_reason || "",
          _sourceRegions: p.source_regions || null,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invoice response
    const normalizedProducts = validated.map((p: Record<string, unknown>, idx: number) => ({
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
      group_key: p.group_key || "",
      cost_source: p.cost_source || "direct",
      _confidence: Number(p.confidence) || 70,
      _parseNotes: p.parse_notes || "",
      _lineTotal: Number(p.line_total) || 0,
      _extractionReason: p.extraction_reason || "",
      _sourceRegions: p.source_regions || null,
      _rowIndex: Number(p.row_index ?? idx),
      _anchorCode: p.anchor_code || p.style_code || "",
      _rowYStart: Number(p.row_y_start) || 0,
      _rowYEnd: Number(p.row_y_end) || 0,
      _rowConfidence: Number(p.row_confidence || p.confidence) || 70,
    }));

    return new Response(JSON.stringify({
      document_type: docType,
      layout_type: layoutType,
      variant_method: variantMethod,
      parsing_plan: parsingPlan,
      detected_fields: detectedFields,
      detected_size_system: detectedSizeSystem,
      supplier: parsed.supplier || supplierName || "",
      invoice_number: parsed.invoice_number || "",
      invoice_date: parsed.invoice_date || "",
      due_date: parsed.due_date || "",
      currency: parsed.currency || "AUD",
      subtotal: parsed.subtotal ?? null,
      gst: parsed.gst ?? null,
      total: parsed.total ?? null,
      rejected_rows: allRejected,
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
