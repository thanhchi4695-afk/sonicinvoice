import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name, supplier, style_number, colour } = await req.json();

    if (!product_name) {
      return new Response(JSON.stringify({ error: "product_name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a realistic search query
    const queryParts = [supplier, product_name, style_number, colour, "Australia price"].filter(Boolean);
    const searchQuery = queryParts.join(" ");

    const systemPrompt = `You are a product research assistant for Australian fashion retailers.
Given a search query for a fashion/swimwear product, generate realistic Google search results that a buyer would see when researching this product's retail price and details.

Focus on:
- Australian retail websites (.com.au domains preferred)
- Official brand websites
- Major Australian department stores (The Iconic, Myer, David Jones)
- Swimwear/fashion specialty retailers

Return STRICT JSON ONLY:
{
  "search_query": "the query you used",
  "results": [
    {
      "title": "Page title as it appears in Google",
      "url": "https://full-url-to-product-page",
      "domain": "domain.com.au",
      "snippet": "Short description snippet from search result",
      "is_australian": true,
      "is_official_brand": false,
      "retailer_type": "department_store|specialty|brand_direct|marketplace"
    }
  ]
}

Return exactly 5 results, prioritising Australian retailers and official brand sites.
If you know real URLs for this product, use them. Otherwise generate plausible results based on known retailer URL patterns.`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Search for: ${searchQuery}\n\nProduct: ${product_name}\nSupplier/Brand: ${supplier || "unknown"}\nStyle Number: ${style_number || "N/A"}\nColour: ${colour || "N/A"}` },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Failed to parse AI response");
    }

    return new Response(JSON.stringify({
      search_query: parsed.search_query || searchQuery,
      results: parsed.results || [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("price-lookup-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
