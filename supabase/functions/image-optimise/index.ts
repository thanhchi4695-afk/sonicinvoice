import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSeoFilename(product: { vendor?: string; title?: string; colour?: string; productType?: string }): string {
  const parts = [
    product.vendor,
    product.title,
    product.productType,
    product.colour,
  ].filter(Boolean).map((p) => slugify(p!));
  return parts.join("-") + ".jpg";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, products } = await req.json();

    if (action === "generate_alt_text") {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productList = products.slice(0, 25).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title || "Unknown"}", Vendor: "${p.vendor || ""}", Colour: "${p.colour || ""}", Type: "${p.productType || ""}", Tags: "${(p.tags || []).join(", ")}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are an SEO image alt text generator for e-commerce products.
Rules:
- Write natural, descriptive alt text (8-15 words)
- Include brand, product type, colour, key features
- Avoid keyword stuffing
- Use sentence case
- Do NOT start with "Image of" or "Photo of"
- Each alt text must be unique

Return a JSON array of objects: [{"index": 0, "alt_text": "...", "seo_filename": "...", "keywords": ["..."]}]
For seo_filename: use lowercase-hyphenated format like "brand-product-type-colour.jpg"
For keywords: extract 3-5 relevant SEO keywords from the product data.`,
          },
          {
            role: "user",
            content: `Generate alt text, SEO filenames, and keywords for these products:\n${productList}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        results = [];
      }

      // Merge back with input and fill gaps
      const output = products.slice(0, 25).map((p: any, i: number) => {
        const match = results.find((r: any) => r.index === i) || {};
        return {
          ...p,
          alt_text: match.alt_text || `${p.vendor || ""} ${p.title || "Product"} in ${p.colour || ""}`.trim(),
          seo_filename: match.seo_filename || buildSeoFilename(p),
          keywords: match.keywords || [],
        };
      });

      return new Response(JSON.stringify({ results: output }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "analyse_quality") {
      // Analyse image URLs for quality issues
      if (!products || !Array.isArray(products)) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imageList = products.slice(0, 30).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title}", Image URL: "${p.imageUrl || "MISSING"}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a product image quality analyser. For each product, assess the image URL and return a JSON array:
[{"index": 0, "status": "ok"|"missing"|"broken"|"low_quality"|"duplicate", "issue": "description or null", "recommendation": "action or null"}]

Rules:
- "missing" if no URL or empty
- "broken" if URL looks malformed or points to a placeholder
- "low_quality" if URL suggests a thumbnail (tiny dimensions in URL params)
- "duplicate" if same URL appears for multiple products
- "ok" if appears valid`,
          },
          {
            role: "user",
            content: `Analyse these product images:\n${imageList}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        results = [];
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("image-optimise error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
