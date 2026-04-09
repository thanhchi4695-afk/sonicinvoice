import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Multi-stage extraction system prompt ────────────────────
const SYSTEM_PROMPT = `You are an expert invoice data extraction AI for a retail product management app (Sonic Invoice).
You handle fashion wholesale invoices that vary wildly in layout. Your job is to classify the document layout, then extract every product with full variant detail.

## STEP 1 — CLASSIFY THE DOCUMENT

Determine the document_type:
- "invoice" — has pricing (cost/unit price)
- "packing_slip" — has items and quantities but NO pricing
- "unknown" — cannot determine

Determine the layout_type:
- "size_grid" — products in rows with size columns across the top (e.g. 6, 8, 10, 12, 14, 16) and quantities underneath. Examples: Seafolly, some Skye Group invoices.
- "size_matrix_inline" — sizes and quantities listed inline in a cell like "10, 12, 14, 16" on one row and "1, 1, 2, 2" on the next row. Example: Skye Group / Jantzen.
- "size_block" — each product has a sub-table or options field with "Size: 06 08 10 12 / Qty: (1) (2) (2) (1)". Example: Rhythm.
- "size_row_below" — product row followed by a size breakdown row like "XS (1) S (2) M (2) L (1)". Example: Sea Level / Bond-Eye.
- "colour_size_in_description" — colour and size are embedded in the description text like "LISA DRESS B2140D NAVY XS". Example: Donna Donna.
- "simple_flat" — simple table with qty, description, price, total. No variants. Example: OM Designs, handwritten invoices.
- "packing_list" — item code + description + quantity, no prices. Example: Kung Fu Mary, delivery dockets.
- "unknown" — mixed or unrecognised layout.

## STEP 2 — EXTRACT PRODUCTS

### For ALL layout types, extract into this JSON structure:

{
  "document_type": "invoice" | "packing_slip" | "unknown",
  "layout_type": "<one of the types above>",
  "supplier": "detected supplier name",
  "invoice_number": "if visible",
  "currency": "AUD" or detected currency,
  "products": [
    {
      "style_code": "raw style/article/product code",
      "product_title": "clean product name without colour/size",
      "colour": "colour name (expanded, not abbreviated)",
      "size": "size value",
      "quantity": number,
      "unit_cost": number or null,
      "rrp": number or null,
      "line_total": number or null,
      "barcode": "if visible",
      "product_type": "e.g. One Piece, Dress, Pant, Top",
      "confidence": 0-100,
      "parse_notes": "any issues or ambiguity"
    }
  ]
}

### CRITICAL RULES BY LAYOUT TYPE:

#### size_grid (e.g. Seafolly)
- Size labels appear as column headers (6, 8, 10, 12, 14, 16, 18, 20)
- Quantities may be circled, struck through, or underlined — these ARE the ordered quantities
- A strikethrough/underline on a size column means that size WAS ordered — extract it
- Create one product row PER size that has quantity > 0
- The "Total Qty" column confirms the sum
- unit_cost is the "Price (Tax excl.)" column, NOT the "Net" (which is the line total)

#### size_matrix_inline (e.g. Skye Group / Jantzen)
- Product code and description on one row with sizes listed as "10, 12, 14, 16, 18, 20, 22, 24"
- Next row has quantities as "1, 1, 2, 2, 1" — these map positionally to the sizes above
- Match each quantity to its corresponding size
- Only create rows for sizes with quantity > 0
- If a size is highlighted/marked (e.g. <mark>18</mark>), that's just formatting — still include it
- Colour codes: BK=Black, NY=Navy, IK=Ink, SW=Seaweed, KH=Khaki, WH=White, etc.

#### size_block (e.g. Rhythm)
- Each product has a main row with Qty, Code, Item, Options, Unit Price, Subtotal
- Below it is an "Options" or detail line with "Size: 06 08 10 12 / Qty: (1) (2) (2) (1)"
- Parse the Size and Qty pairs from the options text
- The colour is in the "Options" column (e.g. "OLIVE OLI")
- Create one row per size with quantity > 0
- unit_cost is from the "Unit Price" column

#### size_row_below (e.g. Sea Level / Bond-Eye)
- Product row: Style, Product Description, Units, RRP, SP (Supplier Price), Disc%, Value, GST, Total
- Next row: "XS (1) S (2) M (2) L (1) XL (1)" — these are the size/qty pairs
- Colour is embedded in the product description (e.g. "Shore Linen Palazzo Pant - White")
- Extract colour from the " - Colour" suffix in description
- unit_cost = SP (Supplier Price) column, NOT RRP
- rrp = RRP column
- Story/collection headers (e.g. "Shore Linen") are NOT products — skip them
- Create one row per size

#### colour_size_in_description (e.g. Donna Donna)
- Each row has: Item code, Description, Quantity, Unit Price, GST, Amount
- Colour and size are embedded in Description: "LISA DRESS B2140D NAVY XS"
- Parse the description to extract: base product name, colour, size
- Common patterns: "NAME CODE COLOUR SIZE" or "NAME CODE COLOUR PRINT SIZE"
- Size values: XS, S/M, SM, L/XL, LXL, O/S, OS, 06, 08, 10, 12, 14, 16
- Group rows with same base product name + code as variants
- "No charge" or "customer replacement" items: set unit_cost to 0, note in parse_notes

#### simple_flat (e.g. OM Designs, handwritten)
- Simple: QTY, DESCRIPTION, PRICE, TOTAL
- No variant detail — create single rows
- "No charge" = unit_cost 0
- "(customer replacement)" lines are notes, not separate products — attach to previous product
- Confidence should be lower (60-70) due to lack of structured data
- Do NOT invent colour or size if not visible

#### packing_list (e.g. Kung Fu Mary, delivery dockets)
- Items + Quantities only, NO prices
- Set unit_cost and rrp to null
- Set document_type to "packing_slip"
- Extract clean product names and quantities
- Strikethrough quantities (e.g. ~~5 of 5~~) mean the item IS included

## STEP 3 — NOISE FILTERING

NEVER include these as products:
- Freight / Shipping charges
- GST / Tax lines
- Subtotal / Total lines
- ASN / Consignment references
- Bank details
- Payment terms
- "Continued on next page"
- Carton/box identifiers
- Empty rows
- Column headers repeated mid-page

## STEP 4 — SIZE SYSTEM DETECTION

Recognise ALL size systems used in fashion:
- Numeric AU/UK: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24
- Numeric US: 0, 2, 4, 6, 8, 10, 12, 14
- Alpha: XXS, XS, S, M, L, XL, XXL, XXXL, 2XL, 3XL
- Combined/dual: S/M, M/L, L/XL, SM, ML
- One size: O/S, OS, One Size, OSFA, FREE
- Cup sizes (swimwear): 8C, 10D, 12DD, 14E, 8-10, 10-12
- Denim: 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 36

When sizes appear as column headers or inline lists, map quantities positionally.
If a size column has no quantity (0 or blank), do NOT create a variant row for it.

## STEP 5 — COLOUR ABBREVIATION EXPANSION

Expand common colour abbreviations:
BK/BLK = Black, NY/NVY = Navy, WH/WHT = White, IK = Ink, SW = Seaweed,
KH = Khaki, OLI/OL = Olive, CRE/CR = Cream, LBL = Light Blue, RD = Red,
PK = Pink, GY/GRY = Grey, BG = Beige, BRN = Brown, COR = Coral,
AQ = Aqua, TQ = Turquoise, MU/MUL = Multi, PR = Print, FL = Floral,
RST = Rust, SAG = Sage, LAV = Lavender, TAN = Tan, PLM = Plum,
MAR = Maroon, CHAR = Charcoal, NAT = Natural, SNW = Snow, SKY = Sky Blue,
EMR = Emerald, MINT = Mint, PEA = Peach, OATML = Oatmeal, LIL = Lilac,
TER = Terracotta, OCH = Ochre, BUR = Burgundy, FUC = Fuchsia, MAU = Mauve

Detect colour from (in priority order):
1. Explicit "Colour" or "Color" column
2. Product description suffix after " - " (e.g. "Palazzo Pant - White")
3. Product description suffix after last space if it matches a known colour
4. Style code suffix if it matches a known abbreviation (e.g. "-NVY", "_BLK")
5. Options/notes field

## STEP 6 — HANDWRITTEN / CIRCLED QUANTITY HANDLING

For invoices with handwritten or circled quantities:
- Circled numbers ARE the ordered quantities — extract them
- Struck-through numbers may mean cancelled OR ordered — check context
- If quantity is ambiguous (unclear handwriting), set confidence to 50-60 and add parse_notes: "handwritten quantity uncertain"
- If a number appears circled/highlighted in a size column, that IS the quantity for that size
- Never assume quantity = 1 if a different number is visible but hard to read
- Ticked/checked boxes next to sizes mean quantity = 1 for that size

## STEP 7 — VARIANT GROUPING RULES

CRITICAL: Each product row you return must represent ONE specific size+colour variant.
- Same style_code + same colour + different sizes = separate rows (same product, different variants)
- Same style_code + different colours = separate rows (same product, different colour variants)
- product_title should be the CLEAN base name WITHOUT colour or size appended
- The "colour" field should contain ONLY the colour
- The "size" field should contain ONLY the size

Example: "Shore Linen Palazzo Pant" in White, sizes S/M/L with qty 1/2/1 = 3 rows:
  { product_title: "Shore Linen Palazzo Pant", colour: "White", size: "S", quantity: 1 }
  { product_title: "Shore Linen Palazzo Pant", colour: "White", size: "M", quantity: 2 }
  { product_title: "Shore Linen Palazzo Pant", colour: "White", size: "L", quantity: 1 }

## STEP 8 — CONFIDENCE SCORING

Score each row 0-100:
- Has product title with 3+ characters: +20
- Has valid unit_cost > 0: +20
- Has recognisable size: +15
- Has colour: +15
- Has style code / SKU: +15
- Has quantity > 0: +15
- Deductions: missing price -20, ambiguous text -10, handwritten -15, uncertain quantity -10

Return ONLY valid JSON. No markdown, no explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileContent, fileName, fileType, customInstructions, supplierName, forceMode } = await req.json();

    if (!fileContent) {
      return new Response(JSON.stringify({ error: "No file content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    let systemPrompt = SYSTEM_PROMPT;

    if (forceMode === "packing_slip") {
      systemPrompt += `\n\nIMPORTANT: The user has confirmed this is a PACKING SLIP. Set document_type to "packing_slip". Do NOT extract prices.`;
    } else if (forceMode === "invoice") {
      systemPrompt += `\n\nIMPORTANT: The user has confirmed this is an INVOICE. Set document_type to "invoice". Extract prices.`;
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
              text: "Classify this document layout, then extract ALL products with full variant breakdown. Create one row per size/colour variant. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Classify this document layout, then extract ALL products with full variant breakdown. Create one row per size/colour variant. Return JSON only.\n\nDocument content:\n${fileContent}`,
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

    const docType = parsed.document_type || (forceMode || "invoice");
    const layoutType = parsed.layout_type || "unknown";

    // Normalize products into the legacy format the frontend expects
    const rawProducts: Array<Record<string, unknown>> = parsed.products || [];

    // Filter noise
    const filtered = rawProducts.filter((p: Record<string, unknown>) => {
      const title = String(p.product_title || p.style_description || p.name || "").toLowerCase();
      const code = String(p.style_code || p.sku || "");
      if (!title && !code) return false;
      if (/^(total|subtotal|sub total|freight|shipping|gst|tax|delivery)$/i.test(title)) return false;
      if (/^carton\s/i.test(title) || /^carton\s/i.test(code)) return false;
      return true;
    });

    if (docType === "packing_slip") {
      // Packing slip response
      return new Response(JSON.stringify({
        document_type: "packing_slip",
        layout_type: layoutType,
        confidence: parsed.confidence || 85,
        supplier: parsed.supplier || supplierName || "",
        supplier_order_number: parsed.supplier_order_number || parsed.invoice_number || "",
        products: filtered.map((p: Record<string, unknown>) => ({
          style_code: p.style_code || p.sku || "",
          colour_code: p.colour || "",
          style_description: p.product_title || p.name || "",
          size: p.size || "",
          quantity: Number(p.quantity) || 0,
          barcode: p.barcode || "",
          confidence: Number(p.confidence) || 70,
          parse_notes: p.parse_notes || "",
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invoice response — normalize to legacy format
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
      // Extended fields
      _confidence: Number(p.confidence) || 70,
      _parseNotes: p.parse_notes || "",
      _lineTotal: Number(p.line_total) || 0,
    }));

    return new Response(JSON.stringify({
      document_type: docType,
      layout_type: layoutType,
      supplier: parsed.supplier || supplierName || "",
      invoice_number: parsed.invoice_number || "",
      currency: parsed.currency || "AUD",
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
