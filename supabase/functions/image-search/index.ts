import { callAI, getContent } from "../_shared/ai-gateway.ts";

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
    const { products } = await req.json();

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "No products provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build search queries for AI with web search capability
    const queries = products.map((p: any, i: number) => ({
      idx: i,
      query: p.searchQuery || `${p.brand || ""} ${p.styleName || ""} ${p.styleNumber || ""} ${p.colour || ""}`.trim(),
      brand: p.brand || "",
      styleName: p.styleName || "",
      styleNumber: p.styleNumber || "",
    }));

    // Use AI with web_search tool to find official product images
    const prompt = `You are a fashion product image finder. For each product below, find the best official product image URL from the brand's website, major retailers, or fashion platforms.

RULES:
- Prefer official brand website images (.jpg, .png, .webp)
- Look for product pages on: brand website, THE ICONIC, David Jones, ASOS, Net-a-Porter, Nordstrom
- Return direct image URLs (not page URLs)
- If you cannot find an exact match, return the closest match or empty string
- URLs must be valid, publicly accessible image URLs

Products to find images for:
${queries.map((q: any) => `${q.idx}. "${q.query}" (Brand: ${q.brand}, Style: ${q.styleName}, Style#: ${q.styleNumber})`).join("\n")}

Return a JSON array: [{"idx": 0, "imageUrl": "https://...", "source": "brand website"}, ...]
If no image found, use empty string for imageUrl.`;

    const result = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a fashion product image search assistant. Return valid JSON only, no markdown fences." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 4000,
      tools: [{
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web for product images",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" }
            },
            required: ["query"]
          }
        }
      }],
    });

    const content = getContent(result);
    let imageResults: any[] = [];
    
    try {
      const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
      imageResults = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON array from response
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          imageResults = JSON.parse(match[0]);
        } catch {
          console.error("Failed to parse image search response:", content);
        }
      }
    }

    // Validate URLs - basic check
    const validatedResults = imageResults.map((r: any) => ({
      idx: r.idx,
      imageUrl: r.imageUrl && r.imageUrl.startsWith("http") ? r.imageUrl : "",
      source: r.source || "",
    }));

    return new Response(
      JSON.stringify({ results: validatedResults }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Image search error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Image search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
