// Sonic SEO meta description generator — calls Anthropic Claude.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { brand, product_name, colour, product_type } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const sys =
      "You are an SEO copywriter for an Australian swimwear and fashion retailer. Write concise, keyword-rich Shopify meta descriptions. Always under 155 characters. No clickbait. Natural language. Mention the brand, key feature, and 'Australia' or 'Australian' naturally.";
    const userPrompt = `Write a meta description for: ${brand ?? ""} ${product_name ?? ""} in ${colour ?? ""}. Product type: ${product_type ?? ""}. Store: Splash Swimwear, Darwin NT.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
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
    const description: string =
      (data?.content?.[0]?.text ?? "").trim().replace(/^["']|["']$/g, "");

    return new Response(JSON.stringify({ description }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sonic-seo-writer error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
