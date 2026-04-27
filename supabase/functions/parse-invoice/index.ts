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

### CRITICAL — GST footer detection (read this BEFORE you decide whether to divide line costs by 1.1):

Inspect the totals block at the bottom of the invoice. There are TWO patterns:

A) **Ex-GST footer** (line costs are ALREADY ex-GST — DO NOT divide them):
   The footer shows three separate lines that reconcile as Subtotal + GST = Total.
   Example (Walnut Melbourne):
       Sub Total      $2,260.20
       G.S.T.           $226.02
       Total          $2,486.22   ← 2260.20 + 226.02 = 2486.22 ✓
   In this case, set "gst_included" = false, emit cost_ex_gst = unit price as printed,
   and emit cost_inc_gst = round(price * 1.1, 2). DO NOT divide the printed price by 1.1.

B) **Inc-GST footer** (line costs INCLUDE GST — divide by 1.1 to get ex-GST):
   The footer shows only a "Total (inc GST)" line, OR the Subtotal already equals the Total.
   In this case, set "gst_included" = true, emit cost_inc_gst = unit price as printed,
   and emit cost_ex_gst = round(price / 1.1, 2).

If you cannot tell, default to A (ex-GST) for AU wholesale invoices — most fashion
wholesale prints line costs ex-GST and GST is added in the footer.

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
- SHOE SIZE GRIDS: Some invoices use numeric shoe sizes as column headers: 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47. These are NOT quantities — they are size labels.
- IMPORTANT: The size labels are COLUMN HEADERS, not quantities. Do NOT treat "XS", "S", "M" or "35", "36", "37" etc. as product data.
- The cells BELOW each size header contain the ordered quantity for that size
- **Circled numbers**: Numbers that are circled (drawn with a ring around them) ARE valid quantities — extract the number inside the circle
- **Numbers with ticks/checkmarks beside them**: The number is the quantity, the tick confirms it
- Underlined or highlighted numbers ARE quantities — extract them
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

**Method 2c: Product block with embedded size grid (COMMON in fashion linesheet-style invoices)**
Each product appears as a visual BLOCK on the page with:
- Product name/title at the top of the block
- Style code (e.g. "Style #SD298PARO")
- A product image (photo or swatch)
- Wholesale price and RRP displayed prominently
- A size grid row with column headers (XS/6, S/8, M/10, L/12, XL/14, XXL/16) and quantities below
- Colour name in a row within the grid
- Line total at the right edge

CRITICAL: Each block is a SEPARATE product. Do NOT merge blocks. Read each block independently:
1. Find the style code (usually starts with # or follows "Style")
2. Read the product name (usually bold, above the style code line)
3. Read wholesale price and RRP
4. Read the colour from the colour row in the grid
5. Read each size column header and its quantity (may be handwritten ticks or printed numbers)
6. Output one variant per size with qty > 0

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

**Method 4b: Two-row Size:/Qty: matrix (Walnut, Stomp, Elka, etc.)**
The product appears as a single header row showing TOTAL qty in the Qty column
(e.g. "Reid Leather Sandal — Coconut Tan — Qty 11 — $68.16"), immediately
followed by TWO sub-rows whose first cell is a label:
  Row A: "Size:"  36   37   38   39   40   41   42
  Row B: "Qty:"    1    1    2    2    2    2    1
- The total qty on the header row MUST equal the sum of Row B (use it as a checksum).
- Create one variant per (size, qty) pair where qty > 0.
- All other fields (style_code, product_title, colour, unit_cost, rrp) come from
  the header row. Do NOT discard the header row's qty — it's the checksum.
- Sizes in Row A may be numeric (36, 37…), alpha (XS, S, M…), OR age-based
  ("1 Year", "2 Year", "3 Year"… up to "16 Year") for kids/baby items.
- Treat "<N> Year", "<N>Y", "<N>yr", "<N>m" (months) as VALID size tokens.

**Method 4c: Multi-invoice PDF (Pattern F)**
A single PDF may contain MULTIPLE separate "Tax Invoice" pages — each with its
own invoice number, customer ref, and total. Detect this when you see the words
"Tax Invoice" (case-insensitive) appearing 2+ times with different invoice
numbers. In that case:
- Extract products from EVERY invoice page, not just the first.
- Tag each product with its source invoice_number in parse_notes.
- The top-level invoice_number/total fields should reflect the FIRST invoice;
  list additional invoices in extraction_notes.

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
- Kids footwear (EU): 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35
- Adult footwear (EU): 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45
- Kids/baby age-based: "0-3 Months", "3-6 Months", "6-12 Months", "1 Year",
  "2 Year", "3 Year", … "16 Year" (also "1Y", "2Y", "1yr", "0-3m", "3-6m")

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
      "collection": "Story / Collection / Delivery / Range label for this row, e.g. 'Summer Chintz', 'Beach Bound', 'Resort 26'. Look for a 'Story' or 'Collection' or 'Delivery' or 'Range' column. If a section header above the row names a collection, inherit it. Empty string if none.",
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
  ],
  "field_confidence": {
    "product_name": 0,
    "sku": 0,
    "colour": 0,
    "size": 0,
    "quantity": 0,
    "cost_ex_gst": 0,
    "rrp_incl_gst": 0,
    "vendor": 0
  },
  "extraction_notes": "brief explanation of any uncertainty across the document",
  "format_type": "A | B | C | D | E | F",
  "overall_confidence": 0
}

## FIELD-LEVEL CONFIDENCE SCORING (REQUIRED)

After extracting all products, assess your own confidence for each field type across the WHOLE invoice (not per row — one score per field type).

Score 0–100 where:
- 90–100: column was unambiguous, header matched exactly
- 70–89: high confidence but header was non-standard
- 50–69: inferred from context, could be wrong
- 30–49: guessed based on data patterns, verify recommended
- 0–29: very uncertain, manual review strongly recommended

Return field_confidence as part of your JSON response with one score for each of:
product_name, sku, colour, size, quantity, cost_ex_gst, rrp_incl_gst, vendor.

Also return:
- "extraction_notes": short string summarising any uncertainty (e.g. "RRP column header missing — inferred from second price column")
- "format_type": one of "A" (single_main_table), "B" (size_grid_matrix), "C" (size_grid_handwritten), "D" (product_block_nested), "E" (size_row_below), "F" (description_embedded / low_structure)
- "overall_confidence": single 0–100 score for the whole document

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

const MULTI_INVOICE_HEADER_RE = /Tax Invoice[\s\S]{0,500}?Invoice No[\s:]+(\d+)/gi;
const TABLE_HEADER_RE = /Code\s+Item\s+Options\s+Qty\s+Unit Price\s+Discount\s+Subtotal/i;
const TABLE_FOOTER_RE = /Product Cost:|Sub Total:|Payment Terms/i;
const MONEY_RE = /\$?\s*(-?\d{1,6}(?:,\d{3})*(?:\.\d{2})|-?\d+(?:\.\d{2}))/;
const SIZE_TOKEN_RE = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|OS|ONE\s*SIZE|FREE\s*SIZE|\d{1,2}|\d{1,2}\s*(?:AU|US|UK|EU|W)|\d{1,2}\s*(?:YEAR|YR|Y)|\d{1,2}\s*-\s*\d{1,2}\s*(?:YEAR|YR|Y)|\d{1,2}\s*(?:MONTH|MONTHS|MO|M)|\d{1,2}\s*-\s*\d{1,2}\s*(?:MONTH|MONTHS|MO|M))$/i;

function cleanInvoiceText(raw: string): string {
  // Preserve column-spacing — runs of spaces encode column separators in
  // PDF-extracted text. Collapsing them destroys our ability to split header
  // rows into [code, title, colour, qty, …] columns. Collapse 4+ to a stable
  // 3-space marker (still unambiguous as a column boundary).
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/ {4,}/g, "   ");
}

function splitMultiInvoicePdf(rawText: string): Array<{ invoiceNumber: string; text: string }> {
  const text = cleanInvoiceText(rawText);
  const markers: Array<{ index: number; invoiceNumber: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = MULTI_INVOICE_HEADER_RE.exec(text)) !== null) {
    markers.push({ index: match.index, invoiceNumber: match[1] || "" });
  }

  if (markers.length <= 1) {
    const invoiceMatch = text.match(/Invoice No[\s:]+(\d+)/i);
    return [{ invoiceNumber: invoiceMatch?.[1] || "", text }];
  }

  return markers.map((marker, idx) => ({
    invoiceNumber: marker.invoiceNumber,
    text: text.slice(marker.index, idx + 1 < markers.length ? markers[idx + 1].index : text.length),
  }));
}

function parseMoney(value: string): number | null {
  const m = String(value || "").match(MONEY_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function isSizeToken(value: string): boolean {
  return SIZE_TOKEN_RE.test(String(value || "").trim());
}

function normalizeWrappedCode(code: string): string {
  const tokens = String(code || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.reduce((acc, token, idx) => {
    if (idx === 0) return token;
    if (token.startsWith("-")) return `${acc}${token}`;
    return `${acc} ${token}`;
  }, "");
}

function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Preserves runs of 2+ spaces (encoded as triple-space) so column separators
// survive trimming. Used for header-row parsing where column boundaries matter.
function normalizeColumnSpaced(value: string): string {
  return String(value || "").replace(/\t/g, "   ").replace(/ {2,}/g, "   ").trim();
}

const SEASON_RE = /^(SS|AW|S|W|FW|HO|RE|HS|MS|LS)\d{2}$/i;

function inferProductType(title: string): string {
  const t = String(title || "").toLowerCase();
  if (/sandal|shoe|boot|sneaker|loafer/.test(t)) return "sandal";
  if (/skirt/.test(t)) return "skirt";
  if (/dress/.test(t)) return "dress";
  if (/pant|trouser/.test(t)) return "pant";
  if (/top|tee|shirt|blouse/.test(t)) return "top";
  return "";
}

function inferDepartment(type: string, sizes: string[]): string | null {
  const hasKidsSizes = sizes.some((size) => /year|yr|month|months|\d+y|\d+m/i.test(size));
  if (!hasKidsSizes) return null;
  return /shoe|sandal|boot|sneaker/i.test(type) ? "kids shoes" : "kids clothing";
}

function findLineItemTable(invoiceText: string): string | null {
  const clean = cleanInvoiceText(invoiceText);
  const headerMatch = clean.match(TABLE_HEADER_RE);
  if (!headerMatch || headerMatch.index == null) return null;
  const start = headerMatch.index + headerMatch[0].length;
  const rest = clean.slice(start);
  const footerMatch = rest.match(TABLE_FOOTER_RE);
  const end = footerMatch?.index != null ? start + footerMatch.index : clean.length;
  return clean.slice(start, end).trim();
}

/**
 * Split the line-item table text into per-product blocks. Each block is one
 * (header-row, Size:, Qty:) triple. Sovereign — never reads sizes outside its
 * own slice. Mirror of src/lib/walnut-parser.ts splitProductBlocks (kept in
 * sync; covered by walnut-parser.test.ts regression).
 */
function splitProductBlocks(tableText: string): string[] {
  // Use column-spaced normalisation so header rows keep their multi-space
  // column separators intact for downstream prefix splitting.
  const lines = tableText.split("\n").map((line) => normalizeColumnSpaced(line)).filter(Boolean);
  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^size\s*:/i.test(line) || /^qty\s*:/i.test(line)) continue;
    if (!/\$/.test(line) || !/\d/.test(line)) continue;
    if (!/\s\d+\s+\$?\s*\d/.test(line)) continue;
    headerIndices.push(i);
  }
  if (headerIndices.length === 0) return [];
  const blocks: string[] = [];
  for (let i = 0; i < headerIndices.length; i += 1) {
    const start = headerIndices[i];
    const end = i + 1 < headerIndices.length ? headerIndices[i + 1] : lines.length;
    blocks.push(lines.slice(start, end).join("\n"));
  }
  return blocks;
}

function extractSizeQtyPairs(tableText: string): Array<{ size: string; quantity: number }> {
  const lines = tableText.split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean);
  const sizeLineIndex = lines.findIndex((line) => /^size\s*:/i.test(line));
  const qtyLineIndex = lines.findIndex((line) => /^qty\s*:/i.test(line));
  if (sizeLineIndex === -1 || qtyLineIndex === -1) return [];

  const sizeTokens = lines[sizeLineIndex].replace(/^size\s*:/i, "").trim().split(/\s{2,}|\t|\s(?=\d{1,2}(?:\s*(?:year|yr|month|months|m|y))?\b)|\s(?=XXS|XS|S|M|L|XL|XXL|XXXL|OS\b)/i).map(normalizeWhitespace).filter(Boolean);
  const qtyTokens = lines[qtyLineIndex].replace(/^qty\s*:/i, "").trim().split(/\s+/).map((token) => Number(token.replace(/[^\d.-]/g, ""))).filter((n) => Number.isFinite(n));

  const sizes = sizeTokens.filter(isSizeToken);
  const count = Math.min(sizes.length, qtyTokens.length);
  const pairs: Array<{ size: string; quantity: number }> = [];
  for (let i = 0; i < count; i += 1) {
    if (qtyTokens[i] > 0) pairs.push({ size: sizes[i], quantity: qtyTokens[i] });
  }
  return pairs;
}

function parseWalnutInvoiceChunks(rawText: string, supplierName?: string) {
  const chunks = splitMultiInvoicePdf(rawText);
  const products: Array<Record<string, unknown>> = [];
  const invoiceNumbers: string[] = [];
  const extractionNotes: string[] = [];
  /**
   * Per-product Qty header validator warnings. Surfaces "extracted N rows
   * but invoice header says Qty: M" mismatches on the review screen so users
   * can confirm or correct before downstream steps run. Catches phantom-row
   * bugs (Walnut 219077 Vermont Pant size 16) AND dropped-row bugs.
   */
  const qtyHeaderWarnings: Array<{
    invoice_number: string;
    product_title: string;
    colour: string;
    extracted_rows: number;
    header_qty: number;
    message: string;
  }> = [];

  chunks.forEach((chunk, invoiceIdx) => {
    const invoiceText = chunk.text;
    const invoiceNumber = chunk.invoiceNumber || invoiceText.match(/Invoice No[\s:]+(\d+)/i)?.[1] || "";
    if (invoiceNumber) invoiceNumbers.push(invoiceNumber);

    const tableText = findLineItemTable(invoiceText);
    if (!tableText) return;

    // ── Per-product block parsing (Round 4 Walnut fix) ──────────
    // Each product is parsed in isolation. Its Size:/Qty: rows are read from
    // its own block only — no cross-product bleed, no cached size template.
    // This is what fixes the Vermont Pant phantom size 16 bug on 219077.
    const productBlocks = splitProductBlocks(tableText);
    let productsBeforeChunk = products.length;

    productBlocks.forEach((blockText, blockIdx) => {
      // Preserve column spacing on header line; size/qty lines are normalised separately.
      const blockLines = blockText.split("\n").map((line) => normalizeColumnSpaced(line)).filter(Boolean);
      const headerRow = blockLines.find((line) => /\$/.test(line) && /\d/.test(line) && !/^size\s*:/i.test(line) && !/^qty\s*:/i.test(line));
      if (!headerRow) return;

      const moneyValues = Array.from(headerRow.matchAll(/\$?\s*\d{1,6}(?:,\d{3})*(?:\.\d{2})/g)).map((m) => parseMoney(m[0])).filter((n): n is number => n != null);
      const qtyMatch = headerRow.match(/\s(\d+)\s+\$?\s*\d/);
      const totalQty = qtyMatch ? Number(qtyMatch[1]) : 0;
      const headerPrefix = qtyMatch ? headerRow.slice(0, qtyMatch.index).trim() : headerRow;

      // Primary split: column separators (2+ spaces).
      let prefixParts = headerPrefix.split(/\s{2,}/).map((part) => normalizeWhitespace(part)).filter(Boolean);

      // Lenient fallback for OCR / single-space text: derive title + colour
      // from the style code itself (`<Title>-<Season>-<Colour>`).
      if (prefixParts.length < 3) {
        const wholeCodePlusRest = normalizeWhitespace(headerPrefix);
        const rawCode = wholeCodePlusRest.split(/\s{2,}|\s(?=[A-Z][a-z]+\s+[A-Z])/)[0] || wholeCodePlusRest;
        const codeNorm = normalizeWrappedCode(rawCode);
        const segments = codeNorm.split("-").map((s) => s.trim()).filter(Boolean);
        const seasonIdx = segments.findIndex((s) => SEASON_RE.test(s));
        if (seasonIdx > 0) {
          const titleFromCode = segments.slice(0, seasonIdx).join(" ").trim();
          const colourFromCode = segments.slice(seasonIdx + 1).join(" ").trim();
          prefixParts = [codeNorm, titleFromCode, colourFromCode].filter(Boolean);
        } else if (segments.length >= 2) {
          prefixParts = [codeNorm, segments[0], segments.slice(1).join(" ")];
        }
      }

      const styleCode = normalizeWrappedCode(prefixParts[0] || "");
      const productTitle = prefixParts[1] || "";
      const colour = normalizeWhitespace((prefixParts.slice(2).join(" ") || "").replace(/\bTan\s+Tan\b/i, "Tan"));

      // Sovereign size/qty extraction — block text only.
      const qtyPairs = extractSizeQtyPairs(blockText);
      const headerSizes = qtyPairs.map((p) => p.size);
      const qtyChecksum = qtyPairs.reduce((sum, pair) => sum + pair.quantity, 0);

      // [size-matrix] telemetry — one log line per product so the literal
      // header read is auditable in production logs.
      console.log(`[size-matrix] invoice=${invoiceNumber} product="${productTitle}" colour="${colour}" header_sizes=[${headerSizes.join(",")}] extracted_rows=${qtyPairs.length} header_qty=${totalQty}`);

      // Qty header validator (defence-in-depth).
      const qtyHeaderMatch = qtyPairs.length === totalQty || qtyChecksum === totalQty;
      if (!qtyHeaderMatch && totalQty > 0) {
        const warning = {
          invoice_number: invoiceNumber,
          product_title: productTitle,
          colour,
          extracted_rows: qtyPairs.length,
          header_qty: totalQty,
          message: `⚠️ Extracted ${qtyPairs.length} size rows but invoice header says Qty: ${totalQty} — please review`,
        };
        qtyHeaderWarnings.push(warning);
        console.warn(`[qty-validator] MISMATCH invoice=${invoiceNumber} product="${productTitle}" extracted=${qtyPairs.length} header=${totalQty}`);
      }

      const unitPrice = moneyValues[0] ?? null;
      const discount = moneyValues.length >= 3 ? moneyValues[1] : (moneyValues.length === 2 && /discount/i.test(headerRow) ? moneyValues[1] : null);
      const lineTotal = moneyValues[moneyValues.length - 1] ?? null;

      let effectiveUnitCost = unitPrice;
      if (unitPrice != null && discount != null) {
        effectiveUnitCost = Math.round((unitPrice - discount) * 100) / 100;
        if (lineTotal != null && totalQty > 0) {
          const subtotalCheck = effectiveUnitCost * totalQty;
          if (Math.abs(subtotalCheck - lineTotal) > 0.05) {
            effectiveUnitCost = Math.round((lineTotal / totalQty) * 100) / 100;
          }
        }
      }

      const productType = inferProductType(productTitle);
      const department = inferDepartment(productType, qtyPairs.map((pair) => pair.size));
      const rowNotes = [
        `invoice_number:${invoiceNumber}`,
        `invoice_index:${invoiceIdx + 1}`,
        `product_block:${blockIdx + 1}/${productBlocks.length}`,
        qtyChecksum === totalQty ? `qty_checksum:${qtyChecksum}` : `qty_checksum_mismatch:${qtyChecksum}/${totalQty}`,
        qtyHeaderMatch ? `qty_header_match:${qtyPairs.length}=${totalQty}` : `qty_header_MISMATCH:${qtyPairs.length}/${totalQty}`,
        discount != null ? "discount_interpreted_as_per_unit" : "no_discount",
        department ? `department:${department}` : "",
      ].filter(Boolean).join("; ");

      // Lower confidence on Qty-validator failures so the review screen flags them.
      const rowConfidence = qtyHeaderMatch ? 96 : 65;

      qtyPairs.forEach((pair, variantIdx) => {
        products.push({
          row_index: products.length,
          anchor_code: styleCode,
          row_y_start: 0.2 + (invoiceIdx * 0.4) + (blockIdx * 0.05) + (variantIdx * 0.005),
          row_y_end: 0.21 + (invoiceIdx * 0.4) + (blockIdx * 0.05) + (variantIdx * 0.005),
          row_confidence: rowConfidence,
          style_code: styleCode,
          product_title: productTitle,
          colour,
          size: pair.size,
          quantity: pair.quantity,
          unit_cost: effectiveUnitCost,
          rrp: null,
          line_total: lineTotal,
          barcode: null,
          product_type: productType,
          group_key: `${styleCode}|${colour}`,
          confidence: rowConfidence,
          parse_notes: rowNotes,
          extraction_reason: qtyHeaderMatch
            ? "Parsed from explicit Walnut Code/Item/Options header with Size:/Qty: matrix (per-product block)"
            : `⚠️ Qty validator: extracted ${qtyPairs.length} sizes but invoice header says Qty: ${totalQty}. Please confirm before pushing.`,
          cost_source: discount != null ? "discount_adjusted" : "direct",
          source_regions: {
            title: { page: invoiceIdx + 1, y_position: 0.24, extraction_method: "table Item column" },
            sku: { page: invoiceIdx + 1, y_position: 0.24, extraction_method: "table Code column" },
            colour: { page: invoiceIdx + 1, y_position: 0.24, extraction_method: "table Options column" },
            size: { page: invoiceIdx + 1, y_position: 0.28, extraction_method: "Size row (per-product block)" },
            quantity: { page: invoiceIdx + 1, y_position: 0.31, extraction_method: "Qty row (per-product block)" },
            cost: { page: invoiceIdx + 1, y_position: 0.24, extraction_method: discount != null ? "Unit Price minus per-unit Discount" : "Unit Price column" },
          },
          // Surface the warning at the row level too so the review-screen
          // FieldConfidenceHeader can flag it without re-running the validator.
          qty_header_warning: qtyHeaderMatch ? null : warning_message_for(productTitle, qtyPairs.length, totalQty),
        });
      });

      extractionNotes.push(`Invoice #${invoiceNumber || invoiceIdx + 1} / "${productTitle}" (${colour}): ${qtyPairs.length} size rows extracted, header Qty: ${totalQty}${qtyHeaderMatch ? "" : " ⚠️ MISMATCH"}`);
      if (department) extractionNotes.push(`Invoice #${invoiceNumber || invoiceIdx + 1} / "${productTitle}": inferred ${department} from age-based sizes`);
    });

    if (products.length === productsBeforeChunk) {
      console.warn(`[parse-invoice] Walnut chunk #${invoiceIdx + 1} produced 0 products — header detection may have failed`);
    }
  });

  if (!products.length) return null;

  const validatorSummary = qtyHeaderWarnings.length === 0
    ? "Qty validator: all products passed."
    : `⚠️ Qty validator flagged ${qtyHeaderWarnings.length} product${qtyHeaderWarnings.length === 1 ? "" : "s"}: ${qtyHeaderWarnings.map((w) => `${w.product_title} (${w.extracted_rows}/${w.header_qty})`).join(", ")}`;

  return {
    supplier: supplierName || "Walnut Melbourne",
    invoice_number: invoiceNumbers[0] || "",
    invoice_numbers: invoiceNumbers,
    parsing_plan: {
      document_type: "tax_invoice",
      layout_type: "mixed",
      variant_method: "size_row_below",
      size_system: "mixed",
      orientation_detected: "portrait",
      rotation_applied: 0,
      line_item_zone: "Rows beneath the Code / Item / Options / Qty / Unit Price / Discount / Subtotal header",
      quantity_field: "Header Qty as checksum plus Size:/Qty: matrix rows (per-product block)",
      cost_field: "Unit Price adjusted by per-unit Discount when present",
      cost_derivation: "direct",
      grouping_required: true,
      grouping_reason: "Each invoice row expands into size variants",
      total_products_expected: chunks.length,
      total_variants_expected: products.length,
      row_anchors_detected: [...new Set(products.map((p) => String(p.style_code || "")).filter(Boolean))],
      row_count: products.length,
      expected_review_level: qtyHeaderWarnings.length > 0 ? "high" : "low",
      review_reason: qtyHeaderWarnings.length > 0
        ? `Qty header validator flagged ${qtyHeaderWarnings.length} product(s) — please confirm size rows match invoice.`
        : "Explicit Walnut invoice header and size matrix were parsed deterministically with per-product block isolation.",
      strategy_explanation: "Split the stitched PDF into per-invoice chunks, then split each invoice into per-product blocks (one block = one header-row + its own Size:/Qty: rows). Each block is sovereign — no cross-product size bleed. Qty header validator runs per product as defence-in-depth.",
    },
    products,
    rejected_rows: [],
    detected_fields: ["invoice_number", "invoice_date", "style_code", "product_title", "colour", "size", "quantity", "unit_cost", "line_total"],
    detected_size_system: products.some((p) => /year|month/i.test(String(p.size || ""))) ? "mixed" : "numeric_au",
    extraction_notes: `This file contains ${chunks.length} invoices — ${invoiceNumbers.map((n) => `#${n}`).join(" and ")} — processed together, ${products.length} line items total. ${validatorSummary} ${extractionNotes.join(" ")}`.trim(),
    qty_header_warnings: qtyHeaderWarnings,
    field_confidence: {
      product_name: 97,
      sku: 98,
      colour: 95,
      size: qtyHeaderWarnings.length > 0 ? 70 : 98,
      quantity: qtyHeaderWarnings.length > 0 ? 70 : 98,
      cost_ex_gst: 95,
      rrp_incl_gst: 0,
      vendor: 98,
    },
    format_type: "B",
    overall_confidence: qtyHeaderWarnings.length > 0 ? 75 : 96,
  };
}

function warning_message_for(productTitle: string, extracted: number, headerQty: number): string {
  return `⚠️ ${productTitle}: extracted ${extracted} sizes but invoice says Qty: ${headerQty}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileContent, fileName, fileType, customInstructions, supplierName, forceMode, templateHint, detailedMode, expectedProductCount, supplierProfile, inferredRules, invoice_classification } = await req.json();

    if (!fileContent) {
      return new Response(JSON.stringify({ error: "No file content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    let systemPrompt = SYSTEM_PROMPT;

    // Stage-1 (Orientation Agent) hint — when present, tells the extractor exactly
    // which supplier/layout/columns to expect so it doesn't have to re-derive them.
    if (invoice_classification && typeof invoice_classification === "object") {
      const cls = invoice_classification as Record<string, unknown>;
      systemPrompt += `\n\n## STAGE-1 CLASSIFICATION (use this — do NOT re-derive column structure)
Supplier: ${cls.supplier_name ?? "unknown"}
Document type: ${cls.document_type ?? "unknown"}
Layout pattern: ${cls.layout_pattern ?? "unknown"}
Column mapping: ${JSON.stringify(cls.column_headers ?? [])}
GST treatment: ${cls.gst_treatment ?? "unknown"}
Currency: ${cls.currency ?? "AUD"}
Has RRP: ${cls.has_rrp ? "yes" : "no"}

Use this classification to guide your extraction. The column mapping tells you exactly which column in this invoice corresponds to which field. Do not re-derive the column structure — use the mapping provided.`;
    }

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

      if (expectedProductCount && expectedProductCount > 0) {
        systemPrompt += `\n\nIMPORTANT: The merchant has confirmed this invoice contains approximately ${expectedProductCount} product rows. You MUST find at least ${expectedProductCount} products. If you find fewer, re-examine the document — you are likely missing rows. Check for highlighted, faded, or partially obscured style codes.`;
      }
    }

    // Force mode overrides
    if (forceMode === "packing_slip") {
      systemPrompt += `\n\nIMPORTANT: The user clicked PACKING SLIP mode. Default behaviour: set document_type to "packing_slip" and unit_cost/rrp to null.

EXCEPTION — handwritten tax invoices: if the document clearly shows the words "TAX INVOICE", "STATEMENT", a printed PRICE/GST/TOTAL column, or handwritten unit prices next to product names, treat it as a HANDWRITTEN INVOICE instead:
- Set document_type to "handwritten_invoice"
- DO extract unit_cost and any RRP shown beside the cost
- Add "user_chose_packing_slip_but_doc_has_prices" to parse_notes so the UI can prompt the user to switch flows.

For genuine packing slips with no prices, follow the standard packing slip rules.

HANDWRITTEN PRODUCT EXTRACTION (applies in either case):
- Each handwritten product line typically has: QTY (left) | DESCRIPTION (centre, may span 2 lines with colour variants below) | PRICE | GST | TOTAL (right)
- **CRITICAL — ONE ROW PER COLOUR.** Indented/dashed lines under a product (e.g. "- Thar Desert", "- Spiral Green", "- Mimi San Bird", "- Brolga Silhouette") are SEPARATE COLOUR VARIANTS. You MUST emit ONE line item per colour. NEVER combine multiple colours into a single row's colour field (e.g. colour: "Thar Desert / Spiral Green" is FORBIDDEN — that must be TWO rows: one with colour "Thar Desert" and one with colour "Spiral Green").
- Colours separated by "/", ",", "&", "and", or listed on separate lines = SEPARATE rows. Each row has exactly ONE colour value.
- **TOTAL QUANTITY IS THE SOURCE OF TRUTH.** The single QTY number written next to the product name (e.g. "4") is the AUTHORITATIVE total for that style. NEVER invent or multiply quantities based on assumed size runs.
- **Quantity splitting rule** — given total QTY = N and C colour variants listed beneath the product:
    • If N is exactly divisible by C → emit C rows (one per colour) each with qty = N/C. Example: QTY 4 with 4 colours (Thar Desert, Spiral Green, Mimi San Bird, Brolga Silhouette) → emit 4 separate rows, each qty=1, each with a single distinct colour.
    • If N is NOT divisible by C → emit C rows, distribute as evenly as possible (e.g. QTY 5, 2 colours → 3 + 2), and flag "qty_uneven_split_across_colours" in parse_notes.
    • If only ONE colour is listed → emit a single row with qty = N (do NOT expand into sizes unless a size grid is explicitly drawn).
    • Never expand a single QTY into a full size run (e.g. QTY 4 must NOT become 2 per size × 5 sizes = 10). Size = "" or "One Size" is acceptable when no size info is present.
- **WORKED EXAMPLE** — packing slip line: "4  Liti Reversible Skirt  - Thar Desert  - Spiral Green  - Mimi San Bird  - Brolga Silhouette" → emit EXACTLY 4 rows:
    1) {product_name: "Liti Reversible Skirt", colour: "Thar Desert", qty: 1}
    2) {product_name: "Liti Reversible Skirt", colour: "Spiral Green", qty: 1}
    3) {product_name: "Liti Reversible Skirt", colour: "Mimi San Bird", qty: 1}
    4) {product_name: "Liti Reversible Skirt", colour: "Brolga Silhouette", qty: 1}
  Do NOT collapse to 2 rows or 1 row. Do NOT use "Thar Desert / Spiral Green" as a colour value.
- Add "qty_split_across_colours" to parse_notes whenever a total QTY was divided across colour variants.
- Read handwritten numbers carefully — distinguish 4 vs 9, 1 vs 7, 0 vs 6
- Do NOT skip rows just because handwriting is messy — extract with lower confidence and flag "handwritten_uncertain"`;
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

    // Supplier Profile (highest priority — from profile builder)
    if (supplierProfile) {
      const sp = supplierProfile;
      systemPrompt += `\n\n## SUPPLIER INVOICE PROFILE (HIGHEST PRIORITY — follow these rules EXACTLY)
This profile was built from analysing ${sp.total_invoices_analysed || sp.invoices_analysed || "multiple"} real invoices from this supplier.
Profile version: ${sp.profile_version || sp.last_updated || "current"}
Profile confidence: ${sp.confidence || "N/A"}

### PRIORITY: USE THIS PROFILE FIRST
1. STRICTLY follow column_mappings, product_name_cleaning_rules, variant_rules, abbreviations, and examples below.
2. This profile is your SINGLE SOURCE OF TRUTH for layout and patterns.
3. If anything in the document contradicts the profile, extract using profile rules but flag the discrepancy.

### Supplier: ${sp.supplier || supplierName || "unknown"}
### Layout: ${sp.invoice_layout || "unknown"} — ${sp.layout_description || ""}

### Column Mappings (use these to find data):`;
      if (sp.column_mappings) {
        for (const [field, mapping] of Object.entries(sp.column_mappings)) {
          if (typeof mapping === "object" && mapping) {
            const m = mapping as Record<string, string>;
            systemPrompt += `\n- **${field}**: header="${m.header || ""}", position="${m.position || ""}" ${m.notes ? `(${m.notes})` : ""}`;
          } else {
            systemPrompt += `\n- **${field}**: ${mapping}`;
          }
        }
      }

      // Product name cleaning rules
      if (sp.product_name_cleaning_rules?.length) {
        systemPrompt += `\n\n### Product Name Cleaning Rules (APPLY in order):`;
        for (const rule of sp.product_name_cleaning_rules) {
          systemPrompt += `\n- ${rule}`;
        }
      }
      systemPrompt += `\n### Product Name Rules: ${sp.product_name_rules || "standard"}`;
      systemPrompt += `\n### Colour Rules: ${sp.colour_rules || "standard"}`;

      // Abbreviations (combined format)
      const abbrevs = sp.abbreviations || sp.colour_abbreviations || {};
      if (Object.keys(abbrevs).length > 0) {
        systemPrompt += `\n### Abbreviations (EXPAND these automatically): ${Object.entries(abbrevs).map(([k, v]) => `${k}→${Array.isArray(v) ? v.join(",") : v}`).join(", ")}`;
      }

      // Variant rules
      if (sp.variant_rules) {
        systemPrompt += `\n### Variant Rules: ${sp.variant_rules}`;
      }
      systemPrompt += `\n### Variant Detection: ${sp.variant_detection_rule || "auto"}`;
      systemPrompt += `\n### Size System: ${sp.size_system || "auto"}`;
      systemPrompt += `\n### Size Rules: ${sp.size_rules || "standard"}`;
      systemPrompt += `\n### GST Handling: ${sp.gst_handling || "exclusive"}`;
      systemPrompt += `\n### Pricing Notes: ${sp.pricing_notes || "standard"}`;

      if (sp.noise_patterns?.length) {
        systemPrompt += `\n\n### Known Noise Patterns (REJECT these): ${sp.noise_patterns.join("; ")}`;
      }
      if (sp.quirks?.length) {
        systemPrompt += `\n\n### Supplier Quirks: ${sp.quirks.join("; ")}`;
      }
      if (sp.extraction_tips) {
        systemPrompt += `\n\n### Extraction Tips: ${sp.extraction_tips}`;
      }
      if (sp.notes_for_future) {
        systemPrompt += `\n### Notes for Future: ${sp.notes_for_future}`;
      }
      if (sp.examples?.length) {
        systemPrompt += `\n\n### Few-Shot Examples (use as guidance for how to parse this supplier's invoices):`;
        for (const ex of sp.examples.slice(0, 6)) {
          const rawField = ex.raw_text || ex.raw_line || "";
          systemPrompt += `\nRaw: "${rawField}" → ${JSON.stringify(ex.extracted)}`;
        }
      }

      systemPrompt += `\n\nADD to your output:
"supplier_profile_used": "Yes",
"used_profile_version": "${sp.profile_version || sp.last_updated || "current"}",
"profile_confidence_boost": <0-100 based on how well this invoice matches the profile patterns>`;
    }

    // Inferred supplier rules (from supplier-inference waterfall — runs BEFORE every extraction)
    if (inferredRules && typeof inferredRules === "object") {
      const ir = inferredRules as Record<string, any>;
      const conf = Number(ir.confidence ?? 0);
      const src = String(ir.rules_source || "");
      const matchedName = ir.matched_supplier_name || supplierName || "this supplier";
      const profileMatch = src === "exact_match" || src === "fuzzy_match" || src === "header_match";

      if (conf >= 70 && profileMatch) {
        systemPrompt += `\n\n## KNOWN SUPPLIER CONTEXT (HIGH CONFIDENCE — apply these rules first)
This invoice is from **${matchedName}**. Based on previous invoices (match: ${src}, confidence ${conf}%), apply these learned rules:
- Cost column is: ${ir.price_column_cost || "(not specified)"}
- RRP column is: ${ir.price_column_rrp || "(not specified)"}
- GST included in cost: ${ir.gst_included_in_cost ? "yes" : "no"}
- GST included in RRP: ${ir.gst_included_in_rrp ? "yes" : "no"}
- Size system: ${ir.size_system || "AU"}
- Currency: ${ir.currency || "AUD"}
- Default markup multiplier: ${ir.default_markup_multiplier ?? 2.2}
- Pack notation expected: ${ir.pack_notation_detected ? "yes" : "no"}
- Size matrix expected: ${ir.size_matrix_detected ? "yes" : "no"}
- Column mapping: ${JSON.stringify(ir.column_map || {})}
${ir.notes?.length ? `- Notes: ${(ir.notes as string[]).join("; ")}` : ""}

Apply these rules first. Only deviate if the current invoice clearly contradicts them — and flag the discrepancy if you do.`;
      } else if (conf >= 40) {
        systemPrompt += `\n\n## SUGGESTED RULES (medium confidence ${conf}% — verify against the document)
Source: ${src}. These are best-guess hints — use them as a starting point, but trust the document over the hints if they conflict.
- Cost column hint: ${ir.price_column_cost || "(unknown)"}
- RRP column hint: ${ir.price_column_rrp || "(unknown)"}
- Size system hint: ${ir.size_system || "AU"}
- Currency hint: ${ir.currency || "AUD"}
- Column mapping hint: ${JSON.stringify(ir.column_map || {})}
${ir.notes?.length ? `- Notes: ${(ir.notes as string[]).join("; ")}` : ""}`;
      }
      // confidence < 40 → no injection; standard extraction runs and pattern learning fires post-extraction.
    }

    if (customInstructions) {
      systemPrompt += `\n\n## USER CUSTOM INSTRUCTIONS (follow these exactly):\n${customInstructions}`;
      systemPrompt += `\n\nIMPORTANT: If user instructions contain bracketed placeholders like [BRAND NAME], [COLUMN NAME], [ABBREVIATION], or [FULL WORD], you MUST substitute them with the actual detected value from the invoice (e.g. the real supplier/brand name). NEVER output the literal placeholder text in product titles or fields.`;
    }
    if (supplierName) {
      systemPrompt += `\nKnown supplier: ${supplierName}`;
    }

    let parsedFromWalnutText = false;
    let deterministicWalnutParsed: Record<string, any> | null = null;
    if (isPdf && /walnut/i.test(fileName || "")) {
      try {
        const walnutText = atob(String(fileContent || ""));
        deterministicWalnutParsed = parseWalnutInvoiceChunks(walnutText, supplierName || "Walnut Melbourne");
        if (deterministicWalnutParsed) {
          parsedFromWalnutText = true;
        }
      } catch {
        // Non-text PDF bytes are expected; continue with the model path below.
      }
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
              text: `Analyse this document photo carefully. 

STEP 1 — ORIENTATION: Check if the photo is rotated sideways (text running vertically). If so, mentally rotate it first.
STEP 2 — LAYOUT: Determine the layout. Common types:
  - Product blocks (each product is a visual block with image, style code, size grid)
  - Landscape table with style codes down the left
  - Standard row table
  - Shoe/footwear invoices with numeric size grids (35-47)
STEP 3 — STYLE CODES: Scan the ENTIRE line-item zone for ALL style codes / SKUs. List them in row_anchors_detected.
STEP 4 — FOR EACH STYLE CODE: Read across the row to extract description, colour, size grid quantities (convert ticks/circles to numbers), unit price, and line total.
STEP 5 — SIZE GRIDS: If sizes appear as column headers (XS, S, M, L or 6, 8, 10, 12 or 35, 36, 37...), read the quantity in each column cell. Handwritten ticks = 1, circled numbers = that number, empty = 0.
STEP 6 — OUTPUT: One variant row per size with qty > 0. Do NOT stop after the first product.

Return JSON only.`,
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

    // Use Flash for everything — Pro routinely exceeds the 150s edge-function
    // idle timeout on multi-page PDFs/photos. Flash is vision-capable and ~3-5x faster.
    // Detailed mode (user explicitly opted in to a slower, deeper pass) keeps Pro.
    const model = detailedMode && (isPdf || isImage)
      ? "google/gemini-2.5-pro"
      : "google/gemini-2.5-flash";

    // Soft time budget so we can skip optional retry/OCR passes before the
    // hard 150s edge timeout kills the whole response.
    const startedAt = Date.now();
    const SOFT_BUDGET_MS = 110_000; // leave ~40s headroom for response + DB writes
    const budgetExceeded = () => Date.now() - startedAt > SOFT_BUDGET_MS;

    let parsed: Record<string, any>;
    let data: unknown = null;
    let content = "";
    let jsonMatch: RegExpMatchArray | [null, string] = [null, ""];
    let jsonStr = "";

    if (parsedFromWalnutText && deterministicWalnutParsed) {
      parsed = deterministicWalnutParsed;
      console.log("[parse-invoice] Used deterministic Walnut multi-invoice parser");
    } else {
      data = await callAI({
        model,
        messages,
        temperature: 0.1,
      });
      content = getContent(data);

      // Extract JSON from response
      jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      jsonStr = (jsonMatch[1] || content).trim();
      parsed = JSON.parse(jsonStr);
    }

    // ── Zero-product retry: if AI returned 0 products, retry with enhanced prompt ──
    const rawProductCount = (parsed.products || []).length;
    if (!parsedFromWalnutText && rawProductCount === 0 && (isImage || isPdf) && !detailedMode && !budgetExceeded()) {
      console.log("[parse-invoice] Zero products detected on first pass — retrying with enhanced prompt");
      const retryMessages = [
        { role: "system", content: systemPrompt + `\n\n## RETRY — ZERO PRODUCTS FOUND ON FIRST PASS
The previous extraction attempt found ZERO products. This is almost certainly wrong — the document clearly contains product data.

INSTRUCTIONS FOR RETRY:
1. Look MORE CAREFULLY at the document. It may be a photo taken at an angle, sideways, or with poor lighting.
2. Try BOTH orientations — if reading left-to-right yields nothing, try reading top-to-bottom (the photo may be rotated).
3. Look for ANY text that could be product descriptions, style codes, or SKUs.
4. If you see a table structure, identify the column headers first, then read the data rows.
5. For product block layouts: each product may appear as a separate visual section with its own image, title, and size grid.
6. Extract EVERYTHING you can see — even partial data with low confidence is better than nothing.
7. If the document appears to be a statement or non-product document, still set document_type correctly and explain why no products were found.` },
        ...messages.slice(1),
      ];
      
      data = await callAI({ model, messages: retryMessages, temperature: 0.2 });
      content = getContent(data);
      jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      jsonStr = (jsonMatch[1] || content).trim();
      parsed = JSON.parse(jsonStr);
      console.log(`[parse-invoice] Retry found ${(parsed.products || []).length} products`);
    }

    // ── Step B: OCR text fallback ──
    // If any line item has confidence < 70 OR quality_warning is set, run a text-extraction
    // pass using a vision model to get raw OCR text, then re-parse with a fast text-only model.
    const products = parsed.products || [];
    const hasLowConfidence = products.some((p: Record<string, unknown>) => (Number(p.confidence) || 0) < 70);
    const hasQualityWarning = parsed.quality_warning === true || parsed.parsing_plan?.expected_review_level === "high";
    const shouldFallbackOCR = (hasLowConfidence || hasQualityWarning) && (isImage || isPdf) && !detailedMode && !budgetExceeded();

    if (!parsedFromWalnutText && shouldFallbackOCR) {
      console.log(`[parse-invoice] Step B: OCR text fallback triggered — lowConf=${hasLowConfidence}, qualityWarn=${hasQualityWarning}`);
      try {
        // Step B.1: Extract raw OCR text from the image using vision model
        const ocrMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [
          {
            role: "system",
            content: `You are a precise OCR engine. Extract ALL visible text from this document image exactly as it appears, preserving the layout structure (rows, columns, spacing). Include every number, code, word, and symbol you can see. Output ONLY the raw text, no commentary or formatting. Preserve table structure using | as column separators and newlines for rows. Include headers, data rows, and totals — extract EVERYTHING visible.`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${isImage ? `image/${fileType === "jpg" ? "jpeg" : fileType}` : "application/pdf"};base64,${fileContent}`,
                },
              },
              { type: "text", text: "Extract all text from this document image. Preserve table layout with | separators." },
            ],
          },
        ];

        const ocrData = await callAI({ model: "google/gemini-2.5-flash", messages: ocrMessages, temperature: 0.0 });
        const ocrText = getContent(ocrData);

        if (ocrText && ocrText.length > 50) {
          console.log(`[parse-invoice] Step B: OCR extracted ${ocrText.length} chars of text`);

          let usedDeterministicWalnutOcr = false;
          if (/walnut/i.test(fileName || "") || /walnut melbourne/i.test(supplierName || "") || /tax invoice[\s\S]{0,500}invoice no[\s:]+\d+/i.test(ocrText)) {
            const deterministicFromOcr = parseWalnutInvoiceChunks(ocrText, supplierName || "Walnut Melbourne");
            if (deterministicFromOcr?.products?.length) {
              console.log(`[parse-invoice] Step B: Using deterministic Walnut OCR parser (${deterministicFromOcr.products.length} products)`);
              parsed = { ...parsed, ...deterministicFromOcr, ocr_fallback_used: true, ocr_text_length: ocrText.length };
              usedDeterministicWalnutOcr = true;
            }
          }

          if (!usedDeterministicWalnutOcr) {
            // Step B.2: Re-parse the OCR text with a fast text-only model
            const ocrParseMessages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `Below is raw OCR text extracted from a fashion supplier invoice image. The original vision extraction had low confidence. Please re-extract ALL product line items from this text.

IMPORTANT:
- Each product row must have: style_code, product_title, quantity, unit_cost, colour, size
- If a value is missing, use null
- Follow the full extraction rules from your system prompt
- Return the same JSON output format as specified

OCR TEXT:
${ocrText}`,
            },
          ];

            const ocrParsed = await callAI({ model: "google/gemini-2.5-flash", messages: ocrParseMessages, temperature: 0.1 });
            const ocrContent = getContent(ocrParsed);
            const ocrJsonMatch = ocrContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, ocrContent];
            const ocrJsonStr = (ocrJsonMatch[1] || ocrContent).trim();

            try {
              const ocrResult = JSON.parse(ocrJsonStr);
              const ocrProducts = ocrResult.products || [];
              console.log(`[parse-invoice] Step B: OCR re-parse found ${ocrProducts.length} products`);

            // Merge strategy: use OCR results if they found more products or higher confidence
            const originalAvgConf = products.length > 0
              ? products.reduce((s: number, p: Record<string, unknown>) => s + (Number(p.confidence) || 0), 0) / products.length
              : 0;
            const ocrAvgConf = ocrProducts.length > 0
              ? ocrProducts.reduce((s: number, p: Record<string, unknown>) => s + (Number(p.confidence) || 0), 0) / ocrProducts.length
              : 0;

              if (ocrProducts.length > products.length || (ocrProducts.length === products.length && ocrAvgConf > originalAvgConf)) {
                console.log(`[parse-invoice] Step B: Using OCR results (${ocrProducts.length} products, avg conf ${ocrAvgConf.toFixed(0)}) over original (${products.length} products, avg conf ${originalAvgConf.toFixed(0)})`);
                parsed.products = ocrProducts;
                parsed.ocr_fallback_used = true;
                parsed.ocr_text_length = ocrText.length;
                if (ocrResult.parsing_plan) parsed.parsing_plan = { ...parsed.parsing_plan, ...ocrResult.parsing_plan, ocr_fallback: true };
                if (ocrResult.rejected_rows) parsed.rejected_rows = [...(parsed.rejected_rows || []), ...ocrResult.rejected_rows];
              } else {
                console.log(`[parse-invoice] Step B: Keeping original results (higher quality)`);
                parsed.ocr_fallback_attempted = true;
                parsed.ocr_fallback_used = false;
              }

            // If BOTH passes returned low confidence, mark as needs_manual_review
              const finalProducts = parsed.products || [];
              const finalAvgConf = finalProducts.length > 0
                ? finalProducts.reduce((s: number, p: Record<string, unknown>) => s + (Number(p.confidence) || 0), 0) / finalProducts.length
                : 0;
              if (finalAvgConf < 60 || finalProducts.length === 0) {
                parsed.needs_manual_review = true;
                parsed.review_reason = finalProducts.length === 0
                  ? "Both vision and OCR fallback failed to extract products"
                  : `Average confidence ${finalAvgConf.toFixed(0)}% is below threshold after OCR fallback`;
                console.log(`[parse-invoice] Step B: Marked as needs_manual_review — ${parsed.review_reason}`);
              }
            } catch (ocrParseErr) {
              console.warn("[parse-invoice] Step B: OCR re-parse JSON failed:", ocrParseErr);
              parsed.ocr_fallback_attempted = true;
              parsed.ocr_fallback_used = false;
            }
          }
        }
      } catch (ocrErr) {
        console.warn("[parse-invoice] Step B: OCR fallback failed:", ocrErr);
        parsed.ocr_fallback_attempted = true;
        parsed.ocr_fallback_used = false;
      }
    }

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

    // ── Walnut Round 2, Bug #1 — GST FOOTER RECONCILIATION ──
    // Many AU wholesale invoices (Walnut Melbourne, Pops + Co, …) print line
    // costs ALREADY ex-GST and show a separate "Sub Total / G.S.T. / Total"
    // footer where Subtotal + GST = Total. The model sometimes still divides
    // line costs by 1.1 a second time, leaving every cost exactly 9.09% short
    // (ratio 0.9091). When we can prove the footer is ex-GST AND the sum of
    // line costs matches the subtotal × 0.909, multiply costs back by 1.1.
    const subtotal = Number(parsed.subtotal) || 0;
    const gstFooter = Number(parsed.gst) || 0;
    const totalFooter = Number(parsed.total) || 0;
    let gstFooterTreatment: "ex_gst" | "inc_gst" | "unknown" = "unknown";
    let gstReconciliationApplied = false;
    if (subtotal > 0 && gstFooter > 0 && totalFooter > 0) {
      const reconstructed = subtotal + gstFooter;
      // Footer is ex-GST iff Subtotal + GST ≈ Total (within 1%).
      if (Math.abs(reconstructed - totalFooter) / totalFooter < 0.01) {
        gstFooterTreatment = "ex_gst";
        const lineSum = validated.reduce((s, p) => {
          const c = Number((p as Record<string, unknown>).unit_cost ?? (p as Record<string, unknown>).cost) || 0;
          const q = Number((p as Record<string, unknown>).quantity ?? (p as Record<string, unknown>).qty) || 0;
          return s + c * q;
        }, 0);
        if (lineSum > 0) {
          const ratio = lineSum / subtotal;
          // 0.9091 ≈ 1/1.1. Allow ±1% tolerance.
          if (ratio > 0.895 && ratio < 0.92) {
            for (const p of validated) {
              const rec = p as Record<string, unknown>;
              if (typeof rec.unit_cost === "number") rec.unit_cost = Math.round(rec.unit_cost * 1.1 * 100) / 100;
              if (typeof rec.cost === "number") rec.cost = Math.round((rec.cost as number) * 1.1 * 100) / 100;
            }
            gstReconciliationApplied = true;
            console.log(`[parse-invoice] GST footer reconciliation: line costs were over-stripped (ratio ${ratio.toFixed(4)}) — multiplied by 1.1.`);
          }
        }
      } else if (Math.abs(subtotal - totalFooter) / totalFooter < 0.01) {
        gstFooterTreatment = "inc_gst";
      }
    }

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
        field_confidence: parsed.field_confidence || null,
        extraction_notes: parsed.extraction_notes || "",
        format_type: parsed.format_type || "",
        overall_confidence: Number(parsed.overall_confidence) || null,
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
      collection: typeof p.collection === "string" ? p.collection.trim() : "",
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
      // Field-level confidence scoring
      field_confidence: parsed.field_confidence || null,
      extraction_notes: parsed.extraction_notes || "",
      format_type: parsed.format_type || "",
      overall_confidence: Number(parsed.overall_confidence) || null,
      // OCR fallback metadata
      ocr_fallback_used: parsed.ocr_fallback_used || false,
      ocr_fallback_attempted: parsed.ocr_fallback_attempted || false,
      needs_manual_review: parsed.needs_manual_review || false,
      review_reason: parsed.review_reason || null,
      // Walnut Round 2, Bug #1: surface the GST-footer detection so the UI
      // can show a banner and the supplier-brain can persist the inference.
      gst_footer_treatment: gstFooterTreatment,
      gst_reconciliation_applied: gstReconciliationApplied,
      invoice_numbers: parsed.invoice_numbers || undefined,
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
