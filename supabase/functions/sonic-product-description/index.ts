// Sonic product description writer — calls Anthropic Claude.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      brand_name = "",
      product_name = "",
      colour = "",
      product_type = "",
      features = [] as string[],
      length_variant = "default", // "default" | "shorter" | "longer"
    } = await req.json();

    if (!product_name && !brand_name) {
      return new Response(
        JSON.stringify({ error: "brand_name or product_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const lengthNote = length_variant === "shorter"
      ? " For this version, write only ONE concise sentence (max ~25 words)."
      : length_variant === "longer"
      ? " For this version, write 4–5 sentences with a touch more detail on fabric, fit, and styling."
      : " Write 2–3 sentences.";

    const sys =
      "You are a product copywriter for an Australian swimwear and fashion boutique. Write Shopify product descriptions. Style: confident, beachy, aspirational but not over the top. No 'perfect for', no 'you'll love'. Start with the product's defining feature. Australian English. Output plain text only — no HTML tags." +
      lengthNote;

    const featureList = Array.isArray(features) && features.length
      ? features.join(", ")
      : "(none specified)";

    const userPrompt =
      `Write a product description for: ${brand_name} ${product_name}${colour ? " in " + colour : ""}. ` +
      `Type: ${product_type || "(unspecified)"}. ` +
      `Features: ${featureList}. ` +
      `Store vibe: premium Australian swimwear boutique, Darwin NT.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: sys,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Anthropic error:", resp.status, t);
      return new Response(
        JSON.stringify({ error: `Claude error ${resp.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    let description: string = (data?.content?.[0]?.text ?? "").trim();
    // Strip any stray HTML just in case
    description = description.replace(/<[^>]+>/g, "").trim();

    return new Response(
      JSON.stringify({
        description,
        brand_name,
        product_name,
        colour,
        product_type,
        features,
        length_variant,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sonic-product-description error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
