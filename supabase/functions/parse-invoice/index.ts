import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileContent, fileName, fileType, customInstructions, supplierName } = await req.json();

    if (!fileContent) {
      return new Response(JSON.stringify({ error: "No file content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // LOVABLE_API_KEY checked by callAI

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    const systemPrompt = `You are an invoice data extraction AI for a retail product management app called Sonic Invoice.

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

${customInstructions ? `\nAdditional instructions from the user:\n${customInstructions}` : ""}
${supplierName ? `\nSupplier name: ${supplierName}` : ""}

Important:
- Extract EVERY product line, do not skip any
- Do NOT include freight/shipping lines as products
- If a field is not visible, use empty string for text or 0 for numbers
- Parse prices as numbers (remove currency symbols)
- If sizes are listed as a range (e.g. 8-16), keep as string
- Detect variant patterns (same product, different size/colour) and list each as separate line`;

    let messages: any[];

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
              text: "Extract all product data from this invoice. Return JSON only.",
            },
          ],
        },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Extract all product data from this invoice/spreadsheet content:\n\n${fileContent}\n\nReturn JSON only.`,
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

    // Normalize: AI may return array directly or {supplier, products}
    const result = Array.isArray(parsed)
      ? { supplier: supplierName || "", products: parsed }
      : { supplier: parsed.supplier || supplierName || "", products: parsed.products || [] };

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
