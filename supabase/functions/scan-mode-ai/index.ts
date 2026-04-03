import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { input, mode, storeName, storeCity } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const messages: Array<{ role: string; content: any }> = [
      {
        role: "system",
        content: `You are a product data assistant for ${storeName || "a retail store"} in ${storeCity || "Australia"}.
Given a product description, barcode, or image, generate clean Shopify-ready product data.

Rules:
- Title: Brand + Product Type + Key Feature. Clean, no supplier codes or noise.
- Type: Category like Dress, Shoes, Swimwear, Accessories, etc.
- Vendor: Brand name if detectable.
- Description: 1-2 sentence retail description.
- Tags: comma-separated relevant tags.
- Australian English.

RESPOND WITH JSON ONLY:
{"title":"...","type":"...","vendor":"...","description":"...","tags":"..."}`,
      },
    ];

    if (mode === "image") {
      // input is a base64 data URL
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "Identify this product and generate Shopify-ready product data." },
          { type: "image_url", image_url: { url: input } },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: `Generate product data for: "${input}"`,
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: mode === "image" ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview",
        messages,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI generation failed");
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const parsed = JSON.parse(clean);
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return new Response(JSON.stringify(parsed), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch {}
      }
      return new Response(JSON.stringify({
        title: input?.substring?.(0, 50) || "Product",
        type: "General",
        vendor: "",
        description: "",
        tags: "",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("scan-mode-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
