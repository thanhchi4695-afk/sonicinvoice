// Extracts product rows + descriptions from a supplier catalog/lookbook PDF or image.
// Used by Catalog Memory upload step (Path 2).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_base64, file_mime, supplier } = await req.json();
    if (!file_base64 || !file_mime) {
      return new Response(JSON.stringify({ error: "file_base64 and file_mime required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a supplier catalog extraction specialist for Australian fashion retailers.
You receive an image or PDF of a supplier line sheet, lookbook, or catalog.
Extract every product you can see, including any short marketing/style description text near each product.

CRITICAL RULES:
1. Only extract data visibly present — never invent.
2. RRP is the recommended retail price (AUD). Skip wholesale-only prices unless RRP is also shown.
3. Description: capture any short marketing/style copy near the product (1-3 sentences). Empty string if none.
4. Fabric: if a composition is shown (e.g. "82% Nylon, 18% Elastane"), capture it.

Return STRICT JSON ONLY:
{
  "products": [
    {
      "title": "Product Name",
      "sku": "SKU123",
      "barcode": "9351234567890",
      "colour": "Coral",
      "size": "8-16",
      "type": "Bikini Top",
      "rrp": 89.95,
      "description": "Short marketing description if present, else empty string",
      "fabric": "Fabric composition if present, else empty string",
      "care": "Care instructions if present, else empty string"
    }
  ]
}`;

    const userParts: any[] = [
      { type: "text", text: `Extract all products from this ${supplier || "supplier"} catalog. Include any descriptive copy near each product.` },
      { type: "image_url", image_url: { url: `data:${file_mime};base64,${file_base64}` } },
    ];

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error("Failed to parse catalog extraction response");
    }

    return new Response(JSON.stringify({
      products: Array.isArray(parsed?.products) ? parsed.products : [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("catalog-pdf-extract error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
