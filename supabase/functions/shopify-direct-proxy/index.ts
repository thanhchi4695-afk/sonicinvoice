// Edge function that proxies Shopify Admin API calls using a Custom App token
// The token is sent per-request from the client (stored in their localStorage)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const API_VERSION = "2024-01";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { store_url, token, action } = body;

    if (!store_url || !token) {
      return new Response(JSON.stringify({ error: "Missing store_url or token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = `https://${store_url}/admin/api/${API_VERSION}`;
    const headers: Record<string, string> = {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    };

    // ── TEST CONNECTION (verifies token + scopes) ──
    if (action === "test") {
      const res = await fetch(`${baseUrl}/shop.json`, { headers });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Shopify returned ${res.status}: ${text.slice(0, 200)}`;
        if (res.status === 401) msg = "Invalid token — check that you copied the Admin API access token (starts with shpat_).";
        else if (res.status === 404) msg = "Store not found — check the store domain (e.g. yourstore.myshopify.com).";
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      const shop = data.shop;

      // Verify granted scopes
      const REQUIRED_SCOPES = ["read_products", "write_products", "read_inventory", "write_inventory", "read_locations"];
      let grantedScopes: string[] = [];
      let missingScopes: string[] = [];
      try {
        const scopesRes = await fetch(`https://${store_url}/admin/oauth/access_scopes.json`, { headers });
        if (scopesRes.ok) {
          const scopesData = await scopesRes.json();
          grantedScopes = (scopesData.access_scopes || []).map((s: { handle: string }) => s.handle);
          missingScopes = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));
        }
      } catch (_e) {
        // Non-fatal — older Custom Apps may not expose this endpoint
      }
      if (missingScopes.length > 0) {
        return new Response(JSON.stringify({
          error: `Missing required Admin API scopes: ${missingScopes.join(", ")}. Update the Custom App in your Shopify admin and reinstall.`,
          granted_scopes: grantedScopes,
          missing_scopes: missingScopes,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const countRes = await fetch(`${baseUrl}/products/count.json`, { headers });
      const countData = countRes.ok ? await countRes.json() : { count: 0 };
      return new Response(JSON.stringify({
        shop_name: shop?.name || "Unknown",
        domain: shop?.myshopify_domain || store_url,
        product_count: countData.count || 0,
        granted_scopes: grantedScopes,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET PRODUCTS PAGE ──
    if (action === "get_products_page") {
      const limit = body.limit || 250;
      const params = new URLSearchParams({
        limit: String(limit),
        fields: "id,handle,title,vendor,product_type,tags,images,variants",
      });
      if (body.page_info) {
        // For cursor pagination, use page_info only (no other params except limit)
        const piParams = new URLSearchParams({ limit: String(limit), page_info: body.page_info });
        const res = await fetch(`${baseUrl}/products.json?${piParams}`, { headers });
        if (!res.ok) {
          return new Response(JSON.stringify({ error: `Shopify ${res.status}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const data = await res.json();
        const linkHeader = res.headers.get("Link") || "";
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        return new Response(JSON.stringify({
          products: data.products || [],
          nextPageInfo: nextMatch ? nextMatch[1] : null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(`${baseUrl}/products.json?${params}`, { headers });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Shopify ${res.status}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      const linkHeader = res.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      return new Response(JSON.stringify({
        products: data.products || [],
        nextPageInfo: nextMatch ? nextMatch[1] : null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SET METAFIELDS (GraphQL) ──
    if (action === "set_metafields") {
      const metafields = body.metafields || [];
      if (metafields.length === 0) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mutation = `
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key namespace value ownerId }
            userErrors { field message code }
          }
        }
      `;

      const gqlRes = await fetch(`https://${store_url}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: mutation, variables: { metafields } }),
      });

      if (!gqlRes.ok) {
        return new Response(JSON.stringify({ error: `GraphQL ${gqlRes.status}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const gqlData = await gqlRes.json();
      const userErrors = gqlData.data?.metafieldsSet?.userErrors || [];
      if (userErrors.length > 0) {
        return new Response(JSON.stringify({ error: userErrors[0].message, userErrors }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, metafields: gqlData.data?.metafieldsSet?.metafields }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
