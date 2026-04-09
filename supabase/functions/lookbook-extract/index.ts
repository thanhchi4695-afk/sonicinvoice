import { callAI } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOOKBOOK_EXTRACTION_PROMPT = `You are analysing a wholesale fashion lookbook image for an Australian swimwear and fashion retailer.

Extract every distinct product visible in this image. For each product, return a JSON array item with:

{
  "style_name": "descriptive product name",
  "style_number": null,
  "description": "2-3 sentence product description based on what you see",
  "product_type": "One Piece|Bikini Top|Bikini Bottom|Rashie|Swimdress|Boardshorts|Kaftan|Dress|Shorts|Shirt|Hat|Bag|Sarong|Cover Up|Leggings|Crop Top|Skirt|Jumpsuit",
  "colour": "primary colour name",
  "colour_secondary": "secondary colour or pattern if applicable, else null",
  "print_type": "solid|floral|stripe|abstract|animal|tropical|geometric|null",
  "fabric_description": "describe the fabric/material visible if possible, else null",
  "target_gender": "Womens|Mens|Kids|Unisex",
  "age_group": "adult|kids",
  "confidence": "high|medium|low"
}

Rules:
- If multiple colourways of the same style are shown, return one item per colourway
- If you cannot determine a field, return null
- confidence = "high" if product is clearly visible and main subject, "medium" if partially visible, "low" if unclear
- Return ONLY a valid JSON array, no other text
- If no fashion products are visible, return []`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { base64, contentType, customPrompt } = await req.json();

    if (!base64) {
      return new Response(
        JSON.stringify({ error: "Missing base64 image data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mediaType = contentType || "image/jpeg";

    const response = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: customPrompt || LOOKBOOK_EXTRACTION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${base64}` },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const rawContent = response.choices[0]?.message?.content || "[]";
    // Extract JSON array from response (handle markdown code blocks)
    let jsonStr = rawContent;
    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    let products: unknown[];
    try {
      products = JSON.parse(jsonStr);
    } catch {
      products = [];
    }

    return new Response(
      JSON.stringify({ products, raw: rawContent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("lookbook-extract error:", err);
    const status = (err as any)?.status || 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
