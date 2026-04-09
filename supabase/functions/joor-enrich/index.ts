import { callAI } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { products, brand, searchImages } = await req.json();

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "No products provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a compact summary for AI
    const productSummary = products.map((p: any, i: number) => ({
      idx: i,
      name: p.styleName,
      style: p.styleNumber,
      colour: p.colour,
      fabrication: p.fabrication || p.materials || "",
      category: p.category || "",
      subcategory: p.subcategory || "",
      rrp: p.rrp,
    }));

    const prompt = `You are a fashion product data expert. Given these products from brand "${brand || "unknown"}", generate enriched product data.

For EACH product, provide:
1. "description" — A compelling 2-3 sentence product description suitable for an online store. Mention fabric, style, and occasion.
2. "productType" — The Shopify product type (e.g., "Dress", "Top", "Pants", "Skirt", "Shirt", "Scarf", "Bag", "Accessory")
3. "tags" — Comma-separated relevant tags for the product (e.g., "linen, midi, occasion, summer")
4. "searchQuery" — A Google Image search query to find the official product image (e.g., "ALEMAIS Kenny Midi Dress Red")
5. "imageUrl" — If you know the brand's website pattern, construct the likely product image URL. Otherwise leave empty.

Products:
${JSON.stringify(productSummary, null, 2)}

Return a JSON array with objects matching each product by idx. Format:
[{"idx": 0, "description": "...", "productType": "...", "tags": "...", "searchQuery": "...", "imageUrl": ""}, ...]`;

    const result = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a fashion product enrichment AI. Return valid JSON only, no markdown." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    // Parse AI response
    let enrichments: any[] = [];
    try {
      const text = result.choices[0]?.message?.content?.replace(/```json\n?|\n?```/g, "").trim() || "[]";
      enrichments = JSON.parse(text);
    } catch {
      console.error("Failed to parse AI response:", result.choices[0]?.message?.content);
      return new Response(
        JSON.stringify({ enrichedProducts: products }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If searchImages flag is set, do a second AI pass to find real image URLs
    if (searchImages) {
      try {
        const imagePrompt = `You are a fashion product image finder with web search capability.

For each product below, search the web and find the best official product image URL. Look on:
- The brand's official website
- THE ICONIC (theiconic.com.au)
- David Jones, ASOS, Net-a-Porter
- Fashion retailer sites

Return DIRECT image URLs (.jpg, .png, .webp) — not page URLs.

Products:
${enrichments.map((e: any, i: number) => {
  const p = products[i];
  return `${i}. Brand: "${brand}", Product: "${p?.styleName || e.searchQuery}", Style#: "${p?.styleNumber || ""}", Colour: "${p?.colour || ""}"`;
}).join("\n")}

Return JSON array: [{"idx": 0, "imageUrl": "https://..."}, ...]
Use empty string if no image found.`;

        const imageResult = await callAI({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Return valid JSON only." },
            { role: "user", content: imagePrompt },
          ],
          temperature: 0.1,
          max_tokens: 3000,
        });

        const imageText = imageResult.choices[0]?.message?.content?.replace(/```json\n?|\n?```/g, "").trim() || "[]";
        let imageResults: any[] = [];
        try {
          imageResults = JSON.parse(imageText);
        } catch {
          const match = imageText.match(/\[[\s\S]*\]/);
          if (match) imageResults = JSON.parse(match[0]);
        }

        // Merge image URLs into enrichments
        for (const img of imageResults) {
          if (img.imageUrl && img.imageUrl.startsWith("http") && enrichments[img.idx]) {
            enrichments[img.idx].imageUrl = img.imageUrl;
          }
        }
      } catch (imgErr) {
        console.error("Image search pass failed (non-fatal):", imgErr);
      }
    }

    // Merge enrichments back into products
    const enrichedProducts = products.map((p: any, i: number) => {
      const enrichment = enrichments.find((e: any) => e.idx === i);
      if (!enrichment) return p;
      return {
        ...p,
        description: enrichment.description || p.description || "",
        category: enrichment.productType || p.category || "",
        subcategory: p.subcategory || "",
        tags: enrichment.tags || "",
        searchQuery: enrichment.searchQuery || "",
        imageUrl: enrichment.imageUrl || p.imageUrl || "",
      };
    });

    return new Response(
      JSON.stringify({ enrichedProducts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Enrichment error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Enrichment failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
