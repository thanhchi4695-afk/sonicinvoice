import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TAXJAR_API_KEY = Deno.env.get("TAXJAR_API_KEY");
  if (!TAXJAR_API_KEY) {
    return new Response(
      JSON.stringify({ error: "TaxJar API key not configured. Using built-in tax tables instead." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "calculate") {
      // Calculate tax for a transaction
      const { to_country, to_state, to_zip, shipping, line_items } = body;

      const resp = await fetch("https://api.taxjar.com/v2/taxes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TAXJAR_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to_country,
          to_state: to_state || "",
          to_zip: to_zip || "",
          shipping: shipping || 0,
          line_items: (line_items || []).map((li: any) => ({
            id: li.id || "1",
            quantity: li.quantity || 1,
            unit_price: li.unit_price || 0,
            product_tax_code: li.tax_code || "",
          })),
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        return new Response(
          JSON.stringify({ error: data.detail || data.error || "TaxJar API error", status: resp.status }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "rates") {
      // Get tax rate for a location
      const { zip, country } = body;
      const resp = await fetch(
        `https://api.taxjar.com/v2/rates/${encodeURIComponent(zip || "")}?country=${country || "US"}`,
        { headers: { Authorization: `Bearer ${TAXJAR_API_KEY}` } },
      );

      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: resp.ok ? 200 : resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use 'calculate' or 'rates'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
