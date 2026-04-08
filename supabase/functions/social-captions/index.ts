import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getToolArgs, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product, settings } = await req.json();
    if (!product?.title) {
      return new Response(JSON.stringify({ error: "product.title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // LOVABLE_API_KEY checked by callAI

    const brand = product.brand || product.vendor || "Brand";
    const title = product.title || "";
    const type = product.type || product.productType || "";
    const tags = Array.isArray(product.tags) ? product.tags : [];

    // Detect colour/print from title
    const dashMatch = title.match(/\s-\s(.+?)(?:,\s*\d|$)/);
    const colourName = dashMatch ? dashMatch[1].trim() : "";

    // Extract features from tags
    const features: string[] = [];
    if (tags.some((t: string) => /chlorine.?resist/i.test(t))) features.push("chlorine resistant");
    if (tags.some((t: string) => /underwire/i.test(t))) features.push("underwire support");
    if (tags.some((t: string) => /tummy.?control/i.test(t))) features.push("tummy control");
    if (tags.some((t: string) => /d-g|d\/g/i.test(t))) features.push("D–G cup");
    if (tags.some((t: string) => /plus.?size/i.test(t))) features.push("plus size");
    if (tags.some((t: string) => /sun.?protect|uv|spf|upf/i.test(t))) features.push("UV protection");

    const featureText = features.length > 0 ? `Special features: ${features.join(", ")}` : "";

    const storeInfo = [
      settings?.storeTagline || "",
      settings?.storeLocation ? `Located in ${settings.storeLocation}` : "",
      settings?.websiteUrl ? `Shop online at ${settings.websiteUrl}` : "",
    ].filter(Boolean).join(". ");

    const brandVoice = settings?.brandVoice || "trendy";

    const prompt = `You are a social media copywriter for a swimwear retail store. Write social media captions for a new product arrival. Your job is to ANNOUNCE that the store NOW STOCKS this item.

PRODUCT:
  Title: ${title}
  Brand: ${brand}
  Product type: ${type}
  Colour/Print: ${colourName || "see image"}
  ${featureText}

STORE INFO: ${storeInfo || "Independent swimwear boutique"}
BRAND VOICE: ${brandVoice}

RULES:
- Mention brand name "${brand}" prominently
- Mention colour/print name if available
- Announce NOW IN STOCK / JUST ARRIVED
- Direct to website or store
- 2-4 emojis max, relevant to swimwear/beach
- No generic phrases like "stunning" or "elevate your style"
- Start strong, not with "Introducing" or "Meet"

WRITE THESE 4 VERSIONS:

FACEBOOK (100-200 words): Conversational, longer, storytelling about the brand.
INSTAGRAM (50-100 words): Punchier, hook in first 2 lines. No hashtags in caption.
YOUTUBE (max 100 chars): Video title format: "Brand Product | In stock now"
TIKTOK (30-60 words): Casual, trending language, hook in first 5 words.

HASHTAGS (20-30): Mix brand, product, location, shopping, trending tags. All lowercase, no spaces.

Return as valid JSON only:
{"facebook":"...","instagram":"...","youtube":"...","tiktok":"...","hashtags":["#tag1","#tag2"]}`;

    const data = await callAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are a retail social media copywriter. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "generate_captions",
          description: "Generate social media captions for a product",
          parameters: {
            type: "object",
            properties: {
              facebook: { type: "string", description: "Facebook caption 100-200 words" },
              instagram: { type: "string", description: "Instagram caption 50-100 words" },
              youtube: { type: "string", description: "YouTube short title max 100 chars" },
              tiktok: { type: "string", description: "TikTok caption 30-60 words" },
              hashtags: { type: "array", items: { type: "string" }, description: "20-30 hashtags" },
            },
            required: ["facebook", "instagram", "youtube", "tiktok", "hashtags"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "generate_captions" } },
    });

    const toolArgs = getToolArgs(data);
    let captions;
    if (toolArgs) {
      captions = JSON.parse(toolArgs);
    } else {
      const raw = getContent(data) || "{}";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      captions = JSON.parse(cleaned);
    }

    return new Response(JSON.stringify(captions), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("social-captions error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Caption generation failed",
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
