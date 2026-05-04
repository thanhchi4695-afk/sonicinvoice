// Generate SEO image alt text via Lovable AI Gateway
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title, vendor, colour, description, store } = await req.json();

    if (!title) {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Write a concise SEO image alt text (max 125 characters) for this product image. The alt text should describe what someone sees in the image.

Product: ${title}
Brand: ${vendor || "(unknown)"}
Colour: ${colour || "(not specified)"}
Store: ${store || ""}
Description: ${(description || "").slice(0, 800)}

Rules:
- Describe the product visually (not the brand story)
- Include colour and key style features
- ${store ? `End with the store name: "${store}"` : "Do not include store name"}
- No quotes, no markdown, just plain text
- Max 125 characters

Example: "Seafolly cobalt blue halter one-piece swimsuit with underwire support — Splash Swimwear Darwin"

Return only the alt text, nothing else.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write concise SEO alt text for product images." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    let altText: string = data.choices?.[0]?.message?.content?.trim() || "";
    // Strip surrounding quotes / markdown
    altText = altText.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (altText.length > 125) altText = altText.slice(0, 122).trimEnd() + "…";

    return new Response(JSON.stringify({ altText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-alt-text error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
