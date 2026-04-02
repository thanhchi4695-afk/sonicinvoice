import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    const openAIApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileType);
    const isPdf = fileType === "pdf";

    let messages: any[];

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

Return ONLY valid JSON in this exact format:
{
  "supplier": "detected supplier name",
  "products": [
    {
      "name": "Product Name",
      "brand": "Brand",
      "sku": "SKU123",
      "barcode": "",
      "type": "Category",
      "colour": "",
      "size": "",
      "qty": 1,
      "cost": 0,
      "rrp": 0
    }
  ]
}

Important:
- Extract EVERY product line, do not skip any
- If a field is not visible, use empty string for text or 0 for numbers
- Parse prices as numbers (remove currency symbols)
- If sizes are listed as a range (e.g. 8-16), keep as string
- Detect variant patterns (same product, different size/colour) and list each as separate line`;

    if (isImage || isPdf) {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${isImage ? `image/${fileType === "jpg" ? "jpeg" : fileType}` : "application/pdf"};base64,${fileContent}`,
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
      // For text-based content (CSV data sent as text)
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Extract all product data from this invoice/spreadsheet content:\n\n${fileContent}\n\nReturn JSON only.`,
        },
      ];
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: isImage || isPdf ? "gpt-4o" : "gpt-4o-mini",
        messages,
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return new Response(JSON.stringify({ error: "AI processing failed", details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const parsed = JSON.parse(jsonStr);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Parse invoice error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
