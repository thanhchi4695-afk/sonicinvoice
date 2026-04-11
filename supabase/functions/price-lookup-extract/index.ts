import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, product_name, supplier, style_number, colour, supplier_cost } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the page HTML
    let pageHtml = "";
    let fetchError = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-AU,en;q=0.9",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!pageRes.ok) {
        fetchError = `HTTP ${pageRes.status}`;
      } else {
        pageHtml = await pageRes.text();
        // Truncate to ~15k chars to fit in AI context
        if (pageHtml.length > 15000) {
          // Try to extract just the product-relevant section
          const bodyMatch = pageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          const bodyContent = bodyMatch ? bodyMatch[1] : pageHtml;
          // Strip script/style tags
          const stripped = bodyContent
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          pageHtml = stripped.slice(0, 15000);
        }
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "Failed to fetch page";
    }

    const systemPrompt = `You are a product data extraction specialist for Australian fashion retailers.
You will receive HTML content from a product page. Extract product information accurately.

CRITICAL RULES:
- Only extract AUD prices. If price is in another currency, flag it.
- Look for structured data (JSON-LD, og: meta tags, schema.org) first — they're most reliable.
- Extract the MAIN product image URL (prefer high-resolution, white background).
- Extract the full marketing description.
- Be careful about sale prices vs regular prices — note both if present.

Return STRICT JSON ONLY:
{
  "product_name": "Full product name as shown on page",
  "brand": "Brand name",
  "retail_price_aud": 129.95,
  "sale_price_aud": null,
  "compare_at_price_aud": null,
  "currency_detected": "AUD",
  "currency_confidence": 95,
  "image_urls": ["https://...high-res.jpg"],
  "description": "Full cleaned marketing description ready for Shopify. Remove any HTML tags. Keep it natural and marketing-focused.",
  "sizes_available": ["8", "10", "12", "14"],
  "colours_available": ["White", "Black"],
  "page_title": "Page title",
  "extraction_notes": "Any concerns or notes about the data quality",
  "price_matches_cost": false,
  "price_vs_cost_note": "Retail is 2.5x supplier cost" 
}

If you cannot find certain data, set it to null. Never make up prices.`;

    const userContent = fetchError
      ? `I could not fetch the page at ${url} (Error: ${fetchError}). Based on the product details alone, provide what you know:\nProduct: ${product_name}\nBrand: ${supplier}\nStyle: ${style_number}\nColour: ${colour}\nSupplier cost: $${supplier_cost || "unknown"} AUD`
      : `Extract product data from this page: ${url}\n\nProduct we're looking for: ${product_name}\nBrand: ${supplier || "unknown"}\nStyle Number: ${style_number || "N/A"}\nColour: ${colour || "N/A"}\nSupplier cost (ex GST): $${supplier_cost || "unknown"} AUD\n\nPage HTML:\n${pageHtml}`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
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
      else throw new Error("Failed to parse AI extraction response");
    }

    // Add metadata
    parsed.source_url = url;
    parsed.fetch_success = !fetchError;
    parsed.fetch_error = fetchError || null;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("price-lookup-extract error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
