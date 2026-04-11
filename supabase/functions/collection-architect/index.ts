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

    const batch = products.slice(0, 20);
    const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";

    const systemPrompt = `You are an expert Shopify collection architect and ${industry || "swimwear/fashion"} SEO specialist.
Your job: Given products from a supplier invoice, generate a complete, scalable hierarchy of smart collection pages that enables strong internal linking and long-tail SEO coverage.

=== COLLECTION HIERARCHY LEVELS ===
1. brand — /collections/{brand-handle} — All products from this brand
2. style — /collections/{brand}-{style} — Sub-brand line or capsule (e.g. Sea Level Breezer)
3. category — /collections/{brand}-{category} — Brand + product type (e.g. Sea Level One Piece)
4. style_category — /collections/{brand}-{style}-{category} — Intersection (e.g. Sea Level Breezer One Piece)
5. feature — /collections/{feature} — Cross-brand attribute (e.g. Bandeau One Piece, Tummy Control)
6. broad_category — /collections/{category} — Generic top-level (e.g. One Piece Swimsuits)
7. colour — /collections/{brand}-{colour} or /collections/{colour}-{category} — Colour-themed
8. print_story — /collections/{brand}-{print} — Print/pattern collection (e.g. Sea Level Hibiscus)
9. seasonal — /collections/{season}-{year} — Seasonal grouping

=== RULES ===
- Generate 8-15 collections per product, covering ALL logical hierarchy levels
- De-duplicate across products (same collection only appears once)
- Every collection needs: title, handle, type, smart_collection_rules (Shopify-compatible), seo_title (<60 chars), meta_description (<160 chars), body_content (150-400 words SEO HTML), internal_links_to (array of handles)
- smart_collection_rules must use valid Shopify rule format: column (tag/title/type/vendor), relation (equals/contains/starts_with), condition
- ${spelling} spelling throughout
- Store: ${storeName || "Swimwear Galore"} in ${storeCity || "Australia"}
- No keyword stuffing, clean modern tone
- body_content should mention key benefits, fit notes, styling ideas with <p> and optional <h2>/<h3> tags
- Include natural internal links using <a href="/collections/{handle}"> in body_content

=== OUTPUT JSON (strict) ===
{
  "brand": "detected brand",
  "product_example": "first product title",
  "collections": [
    {
      "title": "Collection Title",
      "handle": "url-safe-handle",
      "type": "brand|style|category|style_category|feature|broad_category|colour|print_story|seasonal",
      "smart_collection_rules": [
        {"column": "tag|title|type|vendor", "relation": "equals|contains|starts_with", "condition": "value"}
      ],
      "disjunctive": true/false,
      "seo_title": "SEO Title | Store Name",
      "meta_description": "Meta description under 160 chars",
      "body_content": "<p>SEO content...</p>",
      "internal_links_to": ["handle-1", "handle-2"]
    }
  ],
  "suggested_metafields": {
    "style": "string or null",
    "print_story": "string or null",
    "season": "string or null",
    "collection_group": "string or null"
  },
  "internal_linking_strategy": "Paragraph explaining linking approach",
  "total_collections_generated": number
}`;

    const userContent = batch.map((p: any, i: number) => {
      const tags = Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || "");
      return `Product ${i + 1}: title="${p.title || ""}" | brand="${p.vendor || p.brand || ""}" | type="${p.product_type || p.type || ""}" | colour="${p.colour || p.color || ""}" | tags="${tags}" | price=${p.price || p.retail_price || 0} | style_number="${p.style_number || ""}" | description="${(p.description || "").slice(0, 200)}"`;
    }).join("\n");

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any = null;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
    }

    if (!parsed || !Array.isArray(parsed.collections)) {
      parsed = {
        brand: batch[0]?.vendor || "Unknown",
        product_example: batch[0]?.title || "",
        collections: [],
        suggested_metafields: {},
        internal_linking_strategy: "Could not parse AI response",
        total_collections_generated: 0,
      };
    }

    parsed.total_collections_generated = parsed.collections.length;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("collection-architect error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
