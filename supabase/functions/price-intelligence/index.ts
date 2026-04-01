import { corsHeaders } from "@supabase/supabase-js/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { source, barcode, query, apiKey, currency, locale } = await req.json();

    if (!source || !apiKey) {
      return new Response(JSON.stringify({ error: "Missing source or apiKey" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let url = "";
    let headers: Record<string, string> = {};

    if (source === "barcodeLookup") {
      if (!barcode) {
        return new Response(JSON.stringify({ error: "Missing barcode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      url = `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(barcode)}&formatted=y&key=${encodeURIComponent(apiKey)}`;
    } else if (source === "serpApi") {
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing query" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const params = new URLSearchParams({
        engine: "google_shopping",
        q: query,
        gl: locale || "au",
        hl: "en",
        currency: currency || "AUD",
        api_key: apiKey,
      });
      url = `https://serpapi.com/search.json?${params.toString()}`;
    } else if (source === "goUpc") {
      if (!barcode) {
        return new Response(JSON.stringify({ error: "Missing barcode" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      url = `https://go-upc.com/api/v1/code/${encodeURIComponent(barcode)}`;
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown source" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      const body = await resp.text();
      return new Response(JSON.stringify({ error: `Upstream ${resp.status}: ${body.slice(0, 300)}` }), {
        status: resp.status === 401 || resp.status === 403 ? 401 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
