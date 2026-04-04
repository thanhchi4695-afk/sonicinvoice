import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProductDetailAttribute {
  section: string;
  name: string;
  value: string;
}

function extractTagAttributes(tags: string[]): ProductDetailAttribute[] {
  const attrs: ProductDetailAttribute[] = [];
  const t = tags.map(x => x.toLowerCase().trim());

  if (t.some(x => x.includes("chlorine resist")))
    attrs.push({ section: "Material", name: "Feature", value: "Chlorine Resistant" });
  if (t.includes("underwire"))
    attrs.push({ section: "Style", name: "Feature", value: "Underwire" });
  if (t.includes("tummy control"))
    attrs.push({ section: "Style", name: "Feature", value: "Tummy Control" });
  if (t.some(x => x === "d-g"))
    attrs.push({ section: "Sizing", name: "Size Range", value: "D-G Cup" });
  if (t.some(x => x === "a-dd"))
    attrs.push({ section: "Sizing", name: "Size Range", value: "A-DD Cup" });
  if (t.includes("mastectomy"))
    attrs.push({ section: "Style", name: "Feature", value: "Mastectomy Friendly" });
  if (t.some(x => x.includes("period")))
    attrs.push({ section: "Material", name: "Feature", value: "Period Protection" });
  if (t.includes("maternity"))
    attrs.push({ section: "Style", name: "Feature", value: "Maternity" });
  if (t.some(x => x.includes("plus size")))
    attrs.push({ section: "Sizing", name: "Fit Type", value: "Plus Size" });
  if (t.some(x => x.includes("sun protection") || x.includes("upf")))
    attrs.push({ section: "Safety", name: "Sun Protection", value: "UPF 50+" });
  if (t.some(x => x.includes("removable cups") || x.includes("removable cup")))
    attrs.push({ section: "Material", name: "Cups", value: "Removable" });

  return attrs;
}

function mergeAttributes(vision: ProductDetailAttribute[], tags: ProductDetailAttribute[]): ProductDetailAttribute[] {
  const seen = new Set(vision.map(a => `${a.section}:${a.name}`));
  const merged = [...vision];
  tags.forEach(t => {
    const key = `${t.section}:${t.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(t);
    }
  });
  return merged.slice(0, 12);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{
      index: number;
      title: string;
      attributes: ProductDetailAttribute[];
      confidence: string;
      imageQualityNote: string | null;
      error?: string;
    }> = [];

    // Process sequentially to respect rate limits
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const tags = Array.isArray(p.tags) ? p.tags : (p.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean);
      const tagAttrs = extractTagAttributes(tags);

      // If no image, just return tag attrs
      if (!p.imageUrl) {
        results.push({
          index: i,
          title: p.title || "Unknown",
          attributes: tagAttrs.slice(0, 12),
          confidence: tagAttrs.length > 2 ? "medium" : "low",
          imageQualityNote: null,
        });
        continue;
      }

      const tagContext = tags.length > 0 ? `Product tags: ${tags.join(", ")}` : "";
      const prompt = `You are a swimwear product specialist analysing a product for a Google Shopping feed. Your job is to extract accurate, specific attributes from the product image and data.

PRODUCT DATA:
Title: ${p.title || ""}
Brand: ${p.vendor || ""}
Product type: ${p.productType || ""}
Description: ${(p.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)}
${tagContext}

TASK: Look at the product image and identify every attribute that is visible or can be confidently inferred.

For each attribute, return:
  section: A category grouping (Style, Design, Material, Sizing, Occasion, Safety)
  name: The specific attribute name
  value: The precise value you observed

SWIMWEAR ATTRIBUTES TO IDENTIFY:

STYLE (look at the garment's cut and construction):
  Silhouette: One-Piece | Bikini | Tankini | Rashie | Boardshort | Dress
  Neckline: Halter | Scoop | Square | V-Neck | Bandeau | High Neck | Sweetheart | Plunge | Off-Shoulder | Slash Neck | Single Strap | Twist Front
  Back Style: Open | Racerback | Crossback | Tie Back | Full Coverage | Zip Back
  Strap Style: Adjustable | Fixed | Strapless | Tie | Double Strap | Single Strap | Thick Strap | Thin Strap
  Coverage: Minimal | Moderate | Full
  Leg Cut: High-Leg | Regular | Boyleg | Bikini | Brief | Long
  Fit: Regular | Athletic | Curve
  Sleeve Length: Long Sleeve | Short Sleeve | Cap Sleeve | Sleeveless
  Sleeve Style: Raglan | Set-In

DESIGN (look at surface, colour, print):
  Pattern: Solid | Floral | Geometric | Stripe | Animal Print | Abstract | Tropical | Colour Block | Polka Dot
  Print Name: The brand's specific print name if visible in title
  Main Colour: The primary colour you see

MATERIAL/FEATURES (from tags + description):
  Fabric: Polyester | Nylon | Lycra | Recycled Polyester | Eco Fabric
  Feature: Chlorine Resistant | Underwire | Removable Cups | Tummy Control | UPF 50+ | D-G Cup | Mastectomy | Period Protection | Maternity
  Lining: Lined | Unlined
  Cups: Removable | Moulded | Soft

SIZING:
  Fit Type: Standard | Plus Size | Petite
  Size Range: e.g. "D-DD Cup" | "D-G Cup"

OCCASION:
  Activity: Swimming | Beach | Active | Casual
  Style: Sportswear | Fashion | Resort

SAFETY (kids products):
  Sun Protection: UPF 50+

RULES:
- Only include attributes you can CONFIDENTLY identify
- Do not guess or infer weakly
- Use exact values from the lists above where possible
- For print names, use the exact brand name from title
- Do not include size (10, 12, 14) or price
- Maximum 12 attributes per product
- Minimum 4 attributes per product

Return JSON ONLY in this exact format:
{
  "attributes": [
    { "section": "Style", "name": "Silhouette", "value": "One-Piece" }
  ],
  "confidence": "high",
  "imageQualityNote": "clear"
}`;

      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: p.imageUrl } },
                  { type: "text", text: prompt },
                ],
              },
            ],
            max_tokens: 800,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`AI error for product ${i}:`, response.status, errText);
          if (response.status === 429) {
            results.push({ index: i, title: p.title || "Unknown", attributes: tagAttrs, confidence: "low", imageQualityNote: null, error: "Rate limited — try again later" });
            continue;
          }
          if (response.status === 402) {
            results.push({ index: i, title: p.title || "Unknown", attributes: tagAttrs, confidence: "low", imageQualityNote: null, error: "Credits exhausted — add funds in Settings" });
            continue;
          }
          results.push({ index: i, title: p.title || "Unknown", attributes: tagAttrs, confidence: "low", imageQualityNote: null, error: `AI error: ${response.status}` });
          continue;
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim() || "{}";
        const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        const visionAttrs: ProductDetailAttribute[] = (parsed.attributes || []).filter(
          (a: any) => a.section && a.name && a.value
        );

        const merged = mergeAttributes(visionAttrs, tagAttrs);
        results.push({
          index: i,
          title: p.title || "Unknown",
          attributes: merged,
          confidence: parsed.confidence || (merged.length >= 6 ? "high" : merged.length >= 3 ? "medium" : "low"),
          imageQualityNote: parsed.imageQualityNote || null,
        });
      } catch (err) {
        console.error(`Error processing product ${i}:`, err);
        results.push({
          index: i,
          title: p.title || "Unknown",
          attributes: tagAttrs,
          confidence: "low",
          imageQualityNote: null,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }

      // Rate limit delay between products
      if (i < products.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-feed-optimise error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
