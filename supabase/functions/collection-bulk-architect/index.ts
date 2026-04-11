import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products, storeName, storeCity, industry, locale } = await req.json();

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batch = products.slice(0, 40);
    const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";

    const systemPrompt = `You are a Shopify collection architect for ${storeName || "a fashion retailer"} in ${storeCity || "Australia"}.
Industry: ${industry || "swimwear/fashion"}.

TASK: Given a full invoice of products, group them by brand/style/print and generate a COMPLETE hierarchy of smart collections with cross-links between them.

=== GROUPING RULES ===
1. Group products by brand first
2. Within each brand, identify distinct style lines (e.g., "Breezer", "Caracus"), prints/stories (e.g., "Hibiscus", "Arizona Wave"), and categories (One Piece, Bikini Top, etc.)
3. Each group should generate 5-12 collections spanning: brand, style, category, brand+category, feature, broad_category, colour, print_story, seasonal
4. De-duplicate: if two groups would create the same collection (e.g., both generate "One Piece Swimsuits"), include it once

=== COLLECTION FORMAT ===
Each collection object:
{
  "title": "Collection Title",
  "handle": "url-safe-handle",
  "type": "brand|style|category|style_category|feature|broad_category|colour|print_story|seasonal",
  "smart_collection_rules": [{"column":"tag|title|type|vendor","relation":"equals|contains|starts_with","condition":"value"}],
  "disjunctive": true/false,
  "seo_title": "SEO title <60 chars | ${storeName || "Shop"}",
  "meta_description": "Meta desc <160 chars",
  "body_content": "<p>150-400 word SEO HTML with internal <a href=\\"/collections/handle\\"> links</p>",
  "internal_links_to": ["handle-1","handle-2","handle-3"]
}

=== CROSS-LINK FORMAT ===
{
  "from": "handle-a",
  "to": "handle-b",
  "anchor_text": "text for the link",
  "reason": "Why these should link"
}

=== SEO RULES ===
- ${spelling} spelling
- No keyword stuffing
- Clean, modern tone
- Primary keyword 2-3 times max across all content
- body_content must include <a href="/collections/..."> internal links naturally

=== GLOBAL LINKING STRATEGY ===
Provide a paragraph explaining:
- Homepage featured sections layout
- Product page "Shop the collection" blocks
- Footer mega-menu structure
- Breadcrumb hierarchy

=== OUTPUT JSON (strict) ===
{
  "groups": [
    {
      "group_name": "Brand Style Collection Name",
      "brand": "Brand Name",
      "products_in_group": number,
      "product_titles": ["title1","title2"],
      "collections": [... collection objects ...],
      "cross_links": [... cross-link objects ...]
    }
  ],
  "global_collections": [... collections that span across groups like "One Piece Swimsuits", "New Arrivals" ...],
  "global_cross_links": [... cross-links between groups ...],
  "global_linking_strategy": "Detailed paragraph...",
  "total_collections": number,
  "total_cross_links": number,
  "homepage_sections": [
    {"title":"Featured section name","collections":["handle-1","handle-2"],"layout":"carousel|grid"}
  ],
  "footer_menu": [
    {"heading":"Menu column heading","links":[{"title":"Link text","handle":"collection-handle"}]}
  ]
}`;

    const userContent = batch.map((p: any, i: number) => {
      const tags = Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || "");
      return `${i + 1}. "${p.title || p.product_title || ""}" | brand="${p.vendor || p.brand || ""}" | type="${p.product_type || p.type || ""}" | colour="${p.colour || p.color || ""}" | tags="${tags}" | price=${p.price || p.retail_price || 0}`;
    }).join("\n");

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate the full collection hierarchy for this invoice (${batch.length} products):\n\n${userContent}` },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any = null;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
    }

    if (!parsed || !Array.isArray(parsed.groups)) {
      parsed = {
        groups: [],
        global_collections: [],
        global_cross_links: [],
        global_linking_strategy: "Could not parse AI response",
        total_collections: 0,
        total_cross_links: 0,
        homepage_sections: [],
        footer_menu: [],
      };
    }

    // Count totals
    let totalColl = (parsed.global_collections || []).length;
    let totalLinks = (parsed.global_cross_links || []).length;
    (parsed.groups || []).forEach((g: any) => {
      totalColl += (g.collections || []).length;
      totalLinks += (g.cross_links || []).length;
    });
    parsed.total_collections = totalColl;
    parsed.total_cross_links = totalLinks;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("collection-bulk-architect error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
