import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PACKING_SLIP_SYSTEM = `You are a packing slip / delivery docket extraction AI for a retail product management app called Sonic Invoice.

FIRST: Determine if this document is a packing slip / packing list / delivery docket. Look for signals:
- Title contains "PACKING LIST", "PACKING SLIP", "DELIVERY DOCKET", "DELIVERY NOTE"
- Table headers like "Style Code", "Colour Code", "Style Description", "Size", "Qty"
- Absence of cost/unit price/totals per line item
- Carton grouping rows

Return a JSON object with:
{
  "document_type": "packing_slip" | "invoice" | "unknown",
  "confidence": 0-100,
  "supplier": "supplier name if visible",
  "supplier_order_number": "if visible",
  "customer_order_number": "if visible",
  "products": [
    {
      "style_code": "raw style/article code",
      "colour_code": "colour code as shown",
      "style_description": "product description",
      "size": "size value",
      "quantity": number,
      "carton_number": "if visible",
      "barcode": "if visible"
    }
  ]
}

Important rules:
- Extract EVERY product line, do not skip any
- Do NOT include carton separator rows (e.g. "Carton 1 [barcode]") as products
- Do NOT include summary/total rows as products
- Do NOT include repeated header rows as products
- Do NOT try to extract prices — packing slips typically don't have them
- If sizes appear as columns in a matrix, expand each size into a separate row
- Parse quantity as integer
- Keep style_code, colour_code exactly as shown (do not normalize)
- Keep style_description as the raw text`;

const INVOICE_SYSTEM = `You are an invoice data extraction AI for a retail product management app called Sonic Invoice.

Extract ALL product lines from the invoice/document provided. For each product, extract:
- name: Full product name
- brand: Brand/vendor name
- sku: SKU or style code if visible
- barcode: Barcode/EAN if visible
- type: Product type/category (e.g. "Tops", "Dresses", "One Piece")
- colour: Colour if mentioned
- size: Size or size range
- qty: Quantity ordered
- cost: Cost/wholesale price per unit
- rrp: Retail/RRP price per unit (if shown, otherwise 0)

Important:
- Extract EVERY product line, do not skip any
- Do NOT include freight/shipping lines as products
- If a field is not visible, use empty string for text or 0 for numbers
- Parse prices as numbers (remove currency symbols)
- If sizes are listed as a range (e.g. 8-16), keep as string
- Detect variant patterns (same product, different size/colour) and list each as separate line`;

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

    // If forceMode is set, use that directly; otherwise let AI detect
    const isPackingSlipMode = forceMode === "packing_slip";
    const isInvoiceMode = forceMode === "invoice";

    // Build system prompt based on mode
    let systemPrompt: string;

    if (isPackingSlipMode) {
      systemPrompt = PACKING_SLIP_SYSTEM;
    } else if (isInvoiceMode) {
      systemPrompt = INVOICE_SYSTEM;
    } else {
      // Auto-detect mode: ask AI to classify first then extract
      systemPrompt = `You are a document extraction AI for a retail product management app called Sonic Invoice.

STEP 1: Classify this document as one of:
- "packing_slip" — if it's a packing slip, packing list, delivery docket, or delivery note
- "invoice" — if it's a supplier invoice with pricing
- "unknown" — if unclear

Packing slip signals:
- Title contains "PACKING LIST", "PACKING SLIP", "DELIVERY DOCKET", "DELIVERY NOTE"
- Headers like "Style Code", "Colour Code", "Style Description", "Size", "Qty"
- No cost/unit price columns
- Carton grouping

Invoice signals:
- Has "INVOICE" in title
- Has cost/price/amount columns
- Has totals, GST, subtotal

STEP 2: Extract products based on detected type.

If packing_slip, return:
${PACKING_SLIP_SYSTEM.split('Return a JSON object with:')[1]?.split('Important rules:')[0] || ''}

If invoice, return:
{
  "document_type": "invoice",
  "supplier": "supplier name",
  "products": [{ "name", "brand", "sku", "barcode", "type", "colour", "size", "qty", "cost", "rrp" }]
}

Return JSON only.`;
    }

    if (customInstructions) {
      systemPrompt += `\n\nAdditional instructions from the user:\n${customInstructions}`;
    }
    if (supplierName) {
      systemPrompt += `\nSupplier name: ${supplierName}`;
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
              text: isPackingSlipMode
                ? "Extract all product data from this packing slip. Return JSON only."
                : isInvoiceMode
                ? "Extract all product data from this invoice. Return JSON only."
                : "Classify this document and extract all product data. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: isPackingSlipMode
            ? `Extract all product data from this packing slip content:\n\n${fileContent}\n\nReturn JSON only.`
            : isInvoiceMode
            ? `Extract all product data from this invoice/spreadsheet content:\n\n${fileContent}\n\nReturn JSON only.`
            : `Classify this document and extract all product data:\n\n${fileContent}\n\nReturn JSON only.`,
        },
      ];
    }

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages,
      temperature: 0.1,
    });
    const content = getContent(data);

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const parsed = JSON.parse(jsonStr);

    // Determine document type from response
    const detectedType = parsed.document_type || (forceMode || "invoice");

    if (detectedType === "packing_slip") {
      // Packing slip response — filter noise and normalize
      const rawProducts: Array<Record<string, unknown>> = parsed.products || [];
      const filtered = rawProducts.filter((p: Record<string, unknown>) => {
        const desc = String(p.style_description || "").toLowerCase();
        const code = String(p.style_code || "");
        // Filter carton rows, barcode-only rows, summary rows
        if (/^carton\s/i.test(desc) || /^carton\s/i.test(code)) return false;
        if (/^total/i.test(desc)) return false;
        if (!desc && !code) return false;
        // Barcode-only: all digits, length > 8
        if (/^\d{8,}$/.test(code) && !desc) return false;
        return true;
      });

      return new Response(JSON.stringify({
        document_type: "packing_slip",
        confidence: parsed.confidence || 85,
        supplier: parsed.supplier || supplierName || "",
        supplier_order_number: parsed.supplier_order_number || "",
        customer_order_number: parsed.customer_order_number || "",
        products: filtered,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invoice response — normalize as before
    const result = Array.isArray(parsed)
      ? { document_type: "invoice", supplier: supplierName || "", products: parsed }
      : {
          document_type: detectedType,
          supplier: parsed.supplier || supplierName || "",
          products: parsed.products || [],
        };

    return new Response(JSON.stringify(result), {
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
