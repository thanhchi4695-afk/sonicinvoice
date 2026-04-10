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
- "landscape_sideways" — a landscape-oriented invoice photographed sideways; style codes in left column, sizes run horizontally, often with handwritten ticks and prices
- "mixed" — multiple layout patterns in the same document

## STAGE B1.5 — LANDSCAPE / SIDEWAYS INVOICE DETECTION (CHECK BEFORE ZONE EXTRACTION)

Many wholesale fashion invoices are LANDSCAPE format and photographed SIDEWAYS (rotated 90° CW or CCW). You MUST detect this before zone segmentation.

### Detection signals for landscape sideways invoices:
- Text runs vertically (top-to-bottom or bottom-to-top) instead of left-to-right
- The document appears wider than tall in its natural reading orientation
- Size labels (XS, S, M, L, XL or 6, 8, 10, 12, 14) run HORIZONTALLY across a row (they form column headers)
- Style codes appear in a VERTICAL left column
- The table "reads" naturally when mentally rotated 90°

### When a landscape sideways invoice is detected:
1. Set layout_type to "landscape_sideways"
2. **Mentally rotate** the document to its correct reading orientation before extracting
3. After rotation, the structure is typically:
   - LEFT COLUMN: style codes (vertical list, one per product row)
   - MIDDLE COLUMNS: description, colour
   - RIGHT COLUMNS: size grid running horizontally (size headers across the top, quantities in cells)
   - FAR RIGHT: unit price, line total
4. Handwritten elements are COMMON in landscape invoices:
   - **Ticks (✓)** under size columns = quantity 1
   - **Handwritten numbers** beside descriptions = wholesale price
   - **Circled items** = selected/confirmed products
5. Record "orientation_detected": "landscape_sideways" and "rotation_applied": 90 or 270 in parsing_plan

### Landscape row-by-row extraction strategy:
For each style code found in the left column:
1. **Anchor** on the style code (left edge of the row)
2. **Read right** to find the description text and any handwritten price annotation
3. **Continue right** into the size grid — match each column header (size label) with the cell below/beside it
4. **Interpret handwritten marks**: tick = 1, written number = that number, empty = 0, ambiguous = flag
5. **Read far right** for unit price and line total (may be printed or handwritten)
6. **Output** one variant per non-zero size, all sharing the same style_code, description, colour, and unit_cost

## STAGE B2 — TABLE-ZONE EXTRACTION (CRITICAL — DO THIS BEFORE ANY PRODUCT EXTRACTION)

Before extracting ANY products, you MUST segment the entire page into labelled zones and ONLY extract from the line-item zone.

### Zone Segmentation (label every region of the page):

1. **HEADER_ZONE** (y ≈ 0.00–0.10): Company logo, supplier name, brand graphic, ABN/ACN. IGNORE completely.
2. **INVOICE_INFO_ZONE** (y ≈ 0.05–0.20): Invoice metadata boxes — invoice number, invoice date, charge date, despatch date, order number, customer name, customer account number, delivery address, billing address. IGNORE completely — these are NOT products.
3. **LINE_ITEM_ZONE** (the ONLY zone to extract from): The rectangular product table. Identified by:
   - Column headers row containing words like: Style, Code, SKU, Description, Colour, Size, Qty, Units, Price, Cost, Total, RRP
   - Multiple data rows below the header, each starting with a style code or product description
   - Ends BEFORE any subtotal/total row
4. **TOTALS_ZONE** (typically y ≈ 0.80–0.95): Subtotal, Total Excl. GST, GST Amount, Total Incl. GST, Total Units, Total Qty. IGNORE completely.
5. **FOOTER_ZONE** (y ≈ 0.90–1.00): Payment terms, bank details, remittance advice, "Thank you for your order", page numbers. IGNORE completely.

### Record zone boundaries in parsing_plan as "page_zones":
Example:
  "page_zones": {
    "header": { "y_start": 0.00, "y_end": 0.08 },
    "invoice_info": { "y_start": 0.08, "y_end": 0.18 },
    "line_items": { "y_start": 0.20, "y_end": 0.78 },
    "totals": { "y_start": 0.78, "y_end": 0.88 },
    "footer": { "y_start": 0.88, "y_end": 1.00 }
  }

### NON-PRODUCT REJECTION LIST (NEVER extract these as products):

If ANY row or text block contains one of these patterns, it is NOT a product — add it to rejected_rows with a clear rejection_reason:

**Invoice metadata (INVOICE_INFO_ZONE):**
- Invoice Number / Invoice No / Inv No / Tax Invoice
- Customer / Account / Sold To / Ship To / Deliver To
- Delivery Address / Billing Address / ABN / ACN
- Charge Date / Despatch Date / Order Date / Due Date
- Order Number / Purchase Order / Reference / PO#
- Sales Rep / Agent / Territory

**Footer totals (TOTALS_ZONE):**
- Total Units / Total Qty / Total Pieces
- Subtotal / Sub Total / Sub-Total
- Total Excl. GST / Total Ex GST / Net Total
- GST / GST Amount / Tax / VAT
- Total Incl. GST / Total Inc GST / Grand Total / Amount Due / Balance Due
- Freight / Shipping / Delivery Charge / Handling
- Discount / Less Discount / Credit

**Other non-product content:**
- Payment Terms / Terms / Net 30 / EOM / COD
- Bank Details / BSB / Account Number / Remittance
- "Continued on next page" / Page X of Y
- Carton / Carton No / CTN / ASN / Consignment
- Season / Collection / Range header rows (no qty or price)
- Empty rows / repeated column header rows
- "Thank you" / "Please pay" / notes / comments

**CRITICAL**: Only rows from the LINE_ITEM_ZONE that have a style code OR a product description (3+ chars) with at least one of (quantity, price) should become products. Everything else goes into rejected_rows.

## STAGE B3 — STYLE CODE ANCHORING (PRIMARY DETECTION METHOD — DO THIS FIRST)

This is the MOST IMPORTANT stage. Read the invoice like a wholesale buyer: find every style code FIRST, then read across each row.

**PRIORITY: Style code is the PRIMARY signal for product detection.** Do NOT start by reading descriptions or prices. Start by scanning the left column for style codes / SKUs.

**Step 1: Full left-column scan for style codes**
Scan the ENTIRE left column of the line-item table from top to bottom. Collect every cell that looks like a style code:
- Alphanumeric codes: CF08381, CF08446, AB1234, ST-2045, 7234-BLK, W24-101
- Codes with a consistent pattern (same prefix, similar length, repeating format)
- Codes that are highlighted, circled, or marked with pen — these are STILL valid style codes
- Codes in bold, underlined, or differently formatted text
- Even partial codes or codes with handwritten annotations beside them

**Step 2: Each unique style code = one product family**
Every distinct style code found in Step 1 anchors exactly one product row. If you find 8 style codes, you MUST produce at least 8 product families.

**Step 3: Read across each anchored row**
For each style code anchor, read the full row LEFT to RIGHT to extract:
1. Style code (already found)
2. Product description / title (next column or adjacent text)
3. Colour / range (separate column, suffix, or embedded in description)
4. Size grid or size list with quantities
5. Unit price / wholesale cost
6. Line total
7. RRP (if present)

**Step 4: Handle multi-line product entries**
Some products span 2-3 lines (e.g. style code on line 1, description on line 2, size grid on line 3). Group these together — the style code anchors the group.

**Step 5: Fallback when NO style codes are found**
If the left column has NO identifiable style codes:
- Fall back to description-based detection (look for product names)
- Lower confidence by 15 points for all rows
- Set variant_method to indicate fallback
- Add "no_style_codes_found" to parse_notes

**Step 6: Row-level debug output**
For each detected row, record:
- row_index: sequential number (0, 1, 2, ...)
- anchor_code: the style code that started this row (or "DESCRIPTION_FALLBACK" if no code)
- row_confidence: 0-100 for this row (higher when style code is clear)
- row_y_start / row_y_end: normalized 0-1 vertical position

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

**Method 2: Size grid matrix (printed quantities)**
Size labels appear as column headers across the row. Quantities are printed in cells below each size.
- Column headers are size labels: 2XS, XS, S, M, L, XL, 2XL, 3XL — or numeric: 6, 8, 10, 12, 14, 16
- IMPORTANT: The size labels are COLUMN HEADERS, not quantities. Do NOT treat "XS", "S", "M" etc. as product data.
- The cells BELOW each size header contain the ordered quantity for that size
- Circled, underlined, or highlighted numbers ARE quantities — extract them
- Empty or zero cells mean that size was NOT ordered — skip it (create NO variant for that size)
- A "Total Qty" column should confirm the sum of all size quantities
- Create one output row per size with quantity > 0
- Each output row inherits the style_code, colour, unit_cost, and product_title from the parent product row

**Method 2b: Size grid with HANDWRITTEN tick marks / pen annotations (CRITICAL)**
Many fashion wholesale invoices have a printed size grid but the QUANTITIES are written by hand — ticks (✓ / ✔), pen marks, circles, or handwritten numbers.

DETECTION: If you see:
- A row of printed size labels (2XS, XS, S, M, L, XL, 2XL, 3XL or numeric)
- Below or beside each size label: handwritten marks, ticks, circles, or small numbers that are NOT printed text
Then this is a handwritten size grid.

EXTRACTION RULES for handwritten marks:
- A single tick mark (✓, /, |, or a short pen stroke) under a size = quantity 1
- A circled number or clearly written digit (e.g. "2", "3") under a size = that quantity
- Two tick marks (// or ✓✓) = quantity 2
- A cross (×) or dash (-) = quantity 0 (not ordered)
- An empty cell with no mark = quantity 0 (not ordered)
- A dot (.) may indicate 0 or be a stray mark — set quantity to 0 and flag in parse_notes
- If the mark is ambiguous (can't tell if it's 1 or 2, or if it's a tick vs a stray line), set the quantity to your best guess but:
  - Lower row_confidence by 15-20 points
  - Add "handwritten_uncertain" to parse_notes
  - The client will route this to "Needs Review"

CRITICAL: Do NOT confuse:
- Printed size labels (XS, S, M, L) with handwritten quantities
- Handwritten notes/annotations in margins with product data
- Circled style codes with circled quantities (context matters — style codes are in the left column, quantities are under size headers)

OUTPUT: Create one variant row per size where a tick/mark/number is present. Each row gets:
- size: the size label from the column header
- quantity: the interpreted count (1 for tick, N for written number)
- All other fields (style_code, colour, unit_cost, product_title) from the parent row
- confidence: lower by 10-20 if handwritten, add "handwritten_qty" to parse_notes

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

Identify product rows by: having a style code / SKU (primary), OR a descriptive title (3+ chars) with at least one of: quantity, price. Rows with a style code are always product candidates even if other fields are sparse.

## CONFIDENCE SCORING

Score each extracted row 0-100:
- Has style code / SKU (primary anchor): +25
- Has product title with 3+ meaningful characters: +15
- Has valid unit_cost > 0 (NOT derived from RRP): +20
- Has recognisable size value: +10
- Has colour: +10
- Has quantity > 0: +15
- Math cross-check passes (unit_cost × qty ≈ line_total): +5
- Deductions: missing style code (description fallback) -15, missing price -20, ambiguous text -10, handwritten uncertainty -15, uncertain quantity -10, cost derived from line_total -5
- Highlighted/marked style code still readable: no deduction
- Handwritten tick marks clearly readable: no deduction
- Handwritten marks ambiguous: -15 and flag "handwritten_uncertain"
- Size grid with mixed printed/handwritten: -5

## OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no explanation):

{
  "parsing_plan": {
    "document_type": "tax_invoice" | "packing_slip" | "handwritten_invoice" | "statement" | "unknown",
    "layout_type": "<one of the layout types from Stage B>",
    "variant_method": "one_row_per_variant" | "size_grid_matrix" | "size_grid_handwritten" | "product_block_nested" | "size_row_below" | "description_embedded" | "handwritten" | "none",
    "size_system": "numeric_au" | "numeric_us" | "alpha" | "combined" | "cup" | "denim" | "one_size" | "mixed" | "none",
    "orientation_detected": "portrait" | "landscape_sideways" | "unknown",
    "rotation_applied": 0 | 90 | 180 | 270,
    "line_item_zone": "description of where the product rows are located",
    "quantity_field": "description of where/how quantity is expressed",
    "cost_field": "description of which field contains wholesale cost",
    "cost_derivation": "direct" | "from_line_total" | "missing",
    "grouping_required": true | false,
    "grouping_reason": "why grouping is or isn't needed",
    "total_products_expected": number,
    "total_variants_expected": number,
    "page_zones": {
      "header": { "y_start": 0.00, "y_end": 0.08 },
      "invoice_info": { "y_start": 0.08, "y_end": 0.18 },
      "line_items": { "y_start": 0.20, "y_end": 0.78 },
      "totals": { "y_start": 0.78, "y_end": 0.88 },
      "footer": { "y_start": 0.88, "y_end": 1.00 }
    },
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
- STYLE CODE FIRST: Always scan for style codes BEFORE reading descriptions. Style code is the primary product anchor.
- SCAN THE ENTIRE LINE-ITEM TABLE. If you see 10 style codes, you MUST return products from ALL 10 rows.
- Do NOT stop after the first product row. Do NOT return only one item when the table has many.
- Highlighted or pen-marked style codes are STILL valid — do not skip them.
- If consecutive rows each have a unique style code, they are SEPARATE products — never merge them.
- Create ONE output row per size+colour variant where quantity > 0
- product_title must be the CLEAN base name without colour or size appended
- Do NOT hallucinate data that is not visible in the document
- If cost is missing, set unit_cost to null — do not guess
- NEVER use RRP as cost — if only RRP is visible, set unit_cost to null
- If line_total and quantity exist but unit_cost is missing, DERIVE unit_cost = line_total / quantity and set cost_source to "derived_from_line_total"
- For packing slips: set unit_cost and rrp to null, focus on qty extraction
- For handwritten documents: lower confidence, flag uncertain readings
- Always set group_key so the client can group variants correctly
- When no style codes exist, fall back to description-based grouping but flag it`;

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

// ── Server-side noise filter (enhanced with zone-aware rejection) ──
const NOISE_EXACT = new Set([
  "total", "subtotal", "sub total", "sub-total",
  "freight", "shipping", "delivery", "handling",
  "gst", "tax", "vat",
  "discount", "less discount", "credit",
  "amount due", "balance", "balance due", "payment", "deposit",
  "grand total", "net total",
  "total units", "total qty", "total pieces",
  "total excl. gst", "total ex gst", "total excl gst",
  "total incl. gst", "total inc gst", "total incl gst",
  "gst amount", "tax amount",
]);

const NOISE_PATTERNS = [
  /^carton\s/i,
  /^ctn\s/i,
  /^asn\s/i,
  /^consignment/i,
  /^invoice\s*(number|no|#|:)/i,
  /^tax\s*invoice/i,
  /^customer\s/i,
  /^account\s*(number|no|#|:)/i,
  /^sold\s*to/i,
  /^ship\s*to/i,
  /^deliver\s*to/i,
  /^delivery\s*address/i,
  /^billing\s*address/i,
  /^charge\s*date/i,
  /^despatch\s*date/i,
  /^order\s*(number|no|#|date|:)/i,
  /^purchase\s*order/i,
  /^reference\s/i,
  /^po\s*#/i,
  /^sales\s*rep/i,
  /^agent\s/i,
  /^territory\s/i,
  /^abn\s/i,
  /^acn\s/i,
  /^payment\s*terms?/i,
  /^terms?\s*:/i,
  /^net\s*\d+/i,
  /^eom$/i,
  /^cod$/i,
  /^bank\s*details?/i,
  /^bsb\s/i,
  /^remittance/i,
  /^thank\s*you/i,
  /^please\s*pay/i,
  /^continued\s/i,
  /^page\s*\d/i,
  /^\d+[.,]\d{2}$/,  // bare price value
];

function filterNoise(products: Record<string, unknown>[]): { kept: Record<string, unknown>[]; rejected: Record<string, unknown>[] } {
  const kept: Record<string, unknown>[] = [];
  const rejected: Record<string, unknown>[] = [];

  for (const p of products) {
    const title = String(p.product_title || p.style_description || p.name || "").trim();
    const titleLower = title.toLowerCase();
    const code = String(p.style_code || p.sku || "").trim();

    // Rule 1: Empty
    if (!title && !code) {
      rejected.push({ raw_text: JSON.stringify(p), rejection_reason: "Empty title and code" });
      continue;
    }

    // Rule 2: Exact noise term match
    if (NOISE_EXACT.has(titleLower)) {
      rejected.push({ raw_text: title, rejection_reason: `Non-product term: "${title}"` });
      continue;
    }

    // Rule 3: Pattern-based noise match
    let matched = false;
    for (const pat of NOISE_PATTERNS) {
      if (pat.test(title) || pat.test(code)) {
        rejected.push({ raw_text: title || code, rejection_reason: `Non-product pattern: ${pat.source}` });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Rule 4: Row outside line-item zone (if y-position data available)
    const yStart = Number(p.row_y_start) || 0;
    if (yStart > 0) {
      // If row is in the top 5% or bottom 8% of the page, it's likely metadata/totals
      if (yStart < 0.05) {
        rejected.push({ raw_text: title || code, rejection_reason: `Header zone (y=${yStart.toFixed(2)})` });
        continue;
      }
      if (yStart > 0.92) {
        rejected.push({ raw_text: title || code, rejection_reason: `Footer zone (y=${yStart.toFixed(2)})` });
        continue;
      }
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
    const { fileContent, fileName, fileType, customInstructions, supplierName, forceMode, templateHint, detailedMode } = await req.json();

    if (!fileContent) {
      return new Response(JSON.stringify({ error: "No file content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    let systemPrompt = SYSTEM_PROMPT;

    // Detailed mode: stronger extraction for under-extracted invoices
    if (detailedMode) {
      systemPrompt += `\n\n## DETAILED MODE (REPROCESSING — MAXIMUM ACCURACY)

This invoice was previously under-extracted. The merchant believes there are MORE product rows than were found.

CRITICAL INSTRUCTIONS FOR DETAILED MODE:
1. SLOW DOWN. Examine EVERY line of the document carefully. Do not skip any potential product row.
2. Scan the ENTIRE line-item zone from top to bottom, row by row. Count every row that could be a product.
3. For EACH row, check: does it have a style code, SKU, product description, or any product-like content? If yes, extract it.
4. Use AGGRESSIVE style code anchoring — even partial or unclear codes should be treated as product anchors.
5. For size grids: expand EVERY size with quantity > 0 into a separate variant row.
6. If a row is borderline (could be product or noise), INCLUDE it with lower confidence rather than rejecting it.
7. Check for multi-line products: if description wraps to next line, group with the style code row above.
8. Look for products that may be hidden in: highlighted regions, handwritten annotations, stamped text, or faded print.
9. Report total_visible_rows (your count of all potential product rows in the document) in parsing_plan.

The goal is MAXIMUM RECALL — extract everything that could possibly be a product. The merchant will review and reject false positives.`;
    }

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
              text: "Analyse this document. FIRST check if it's a landscape/sideways photo — if text runs vertically or the table is wider than tall, mentally rotate it before extraction. Then scan the entire line-item table and identify ALL style code anchors (e.g. CF08381, CF08446, etc.) — list them in row_anchors_detected. For each style code, read across the full row: description, colour, size grid (converting handwritten ticks to quantities), unit price, and line total. Extract EVERY product row, expanding size variants. Do NOT stop after the first row. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyse this document. Check if it's landscape/sideways format. FIRST scan the entire line-item table and identify ALL style code anchors — list them in row_anchors_detected. For each anchor, read the full row including size grid (interpret handwritten ticks as quantities). Extract EVERY product row, expanding size variants. Do NOT stop after the first row. Return JSON only.\n\nDocument content:\n${fileContent}`,
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
