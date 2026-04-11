import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetch /products.json from a Shopify store with pagination */
async function fetchShopifyProducts(baseUrl: string): Promise<any[]> {
  let url = baseUrl.replace(/\/+$/, "");
  if (!url.startsWith("http")) url = `https://${url}`;

  const allProducts: any[] = [];
  let page = 1;
  const maxPages = 5; // limit to avoid excessive requests

  while (page <= maxPages) {
    const res = await fetch(`${url}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "SonicInvoices/1.0 (price-comparison)" },
    });
    if (!res.ok) throw new Error(`Failed to fetch products from ${url}: ${res.status}`);
    const data = await res.json();
    if (!data.products?.length) break;
    allProducts.push(...data.products);
    if (data.products.length < 250) break;
    page++;
    // Rate limiting: 1s delay between pages
    await new Promise((r) => setTimeout(r, 1000));
  }

  return allProducts;
}

/** Use AI to find the best matching product */
async function findBestMatch(
  targetProduct: { title: string; vendor?: string; sku?: string; type?: string },
  competitorProducts: any[]
): Promise<{ matchedTitle: string; matchedPrice: number; matchedUrl: string; confidence: number } | null> {
  // First try exact/fuzzy title match without AI
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetNorm = normalise(targetProduct.title);

  // Simple scoring
  let bestScore = 0;
  let bestProduct: any = null;

  for (const p of competitorProducts) {
    const pNorm = normalise(p.title);
    let score = 0;

    // Exact match
    if (pNorm === targetNorm) score = 100;
    // Contains
    else if (pNorm.includes(targetNorm) || targetNorm.includes(pNorm)) score = 80;
    // Word overlap
    else {
      const targetWords = targetNorm.split(/\s+/);
      const pWords = pNorm.split(/\s+/);
      const overlap = targetWords.filter((w: string) => pWords.some((pw: string) => pw.includes(w) || w.includes(pw)));
      score = Math.round((overlap.length / Math.max(targetWords.length, 1)) * 70);
    }

    // Vendor match bonus
    if (targetProduct.vendor && p.vendor && normalise(p.vendor) === normalise(targetProduct.vendor)) {
      score = Math.min(100, score + 15);
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = p;
    }
  }

  // If fuzzy match is weak, try AI
  if (bestScore < 60 && competitorProducts.length > 0) {
    try {
      const subset = competitorProducts.slice(0, 50).map((p: any) => ({
        id: p.id,
        title: p.title,
        vendor: p.vendor,
        price: p.variants?.[0]?.price,
      }));

      const aiResult = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: "You match products. Return JSON: {matchedId, confidence}. matchedId is the id of the best match from the list, confidence is 1-100. If no good match, return {matchedId: null, confidence: 0}.",
          },
          {
            role: "user",
            content: `Find the best match for: "${targetProduct.title}" (vendor: "${targetProduct.vendor || "unknown"}", SKU: "${targetProduct.sku || "unknown"}")\n\nFrom these products:\n${JSON.stringify(subset)}`,
          },
        ],
      });

      const content = getContent(aiResult);
      const parsed = JSON.parse(content.replace(/```json?\n?/g, "").replace(/```/g, "").trim());

      if (parsed.matchedId && parsed.confidence > bestScore) {
        bestProduct = competitorProducts.find((p: any) => p.id === parsed.matchedId) || bestProduct;
        bestScore = parsed.confidence;
      }
    } catch (e) {
      console.warn("AI matching failed, using fuzzy result:", e);
    }
  }

  if (!bestProduct || bestScore < 20) return null;

  const price = parseFloat(bestProduct.variants?.[0]?.price || "0");
  return {
    matchedTitle: bestProduct.title,
    matchedPrice: price,
    matchedUrl: bestProduct.handle ? `/products/${bestProduct.handle}` : "",
    confidence: bestScore,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { competitor_id, monitored_product_ids } = body;

    if (!competitor_id || !monitored_product_ids?.length) {
      return json({ error: "competitor_id and monitored_product_ids required" }, 400);
    }

    // Get competitor
    const { data: competitor } = await supabase
      .from("competitors")
      .select("*")
      .eq("id", competitor_id)
      .eq("user_id", user.id)
      .single();

    if (!competitor) return json({ error: "Competitor not found" }, 404);

    // Get monitored products
    const { data: monitoredProducts } = await supabase
      .from("competitor_monitored_products")
      .select("*")
      .in("id", monitored_product_ids)
      .eq("user_id", user.id);

    if (!monitoredProducts?.length) return json({ error: "No products found" }, 404);

    // Fetch competitor products
    let competitorProducts: any[];
    try {
      competitorProducts = await fetchShopifyProducts(competitor.website_url);
    } catch (e) {
      // Update all as error
      for (const mp of monitoredProducts) {
        await supabase.from("competitor_prices").upsert({
          user_id: user.id,
          monitored_product_id: mp.id,
          competitor_id: competitor.id,
          match_status: "error",
          error_message: `Failed to fetch: ${(e as Error).message}`,
          last_checked: new Date().toISOString(),
        }, { onConflict: "monitored_product_id,competitor_id" });
      }
      return json({ error: `Failed to fetch competitor products: ${(e as Error).message}` }, 502);
    }

    const results = [];

    for (const mp of monitoredProducts) {
      // Rate limit between products
      if (results.length > 0) await new Promise((r) => setTimeout(r, 500));

      const match = await findBestMatch(
        { title: mp.product_title, vendor: mp.product_vendor, sku: mp.product_sku, type: mp.product_type },
        competitorProducts
      );

      const priceRecord: Record<string, unknown> = {
        user_id: user.id,
        monitored_product_id: mp.id,
        competitor_id: competitor.id,
        last_checked: new Date().toISOString(),
      };

      if (match) {
        const fullUrl = competitor.website_url.replace(/\/+$/, "") + match.matchedUrl;
        priceRecord.matched_title = match.matchedTitle;
        priceRecord.matched_url = fullUrl;
        priceRecord.competitor_price = match.matchedPrice;
        priceRecord.confidence_score = match.confidence;
        priceRecord.match_status = match.confidence >= 80 ? "matched" : "review";
        priceRecord.error_message = null;
      } else {
        priceRecord.match_status = "not_found";
        priceRecord.error_message = "No matching product found";
        priceRecord.competitor_price = null;
        priceRecord.confidence_score = 0;
      }

      // Check if existing record
      const { data: existing } = await supabase
        .from("competitor_prices")
        .select("id")
        .eq("monitored_product_id", mp.id)
        .eq("competitor_id", competitor.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase.from("competitor_prices").update(priceRecord).eq("id", existing.id);
      } else {
        await supabase.from("competitor_prices").insert(priceRecord);
      }

      results.push({ product: mp.product_title, ...priceRecord });
    }

    return json({ success: true, results, products_found: competitorProducts.length });
  } catch (e) {
    console.error("competitor-price-fetch error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
