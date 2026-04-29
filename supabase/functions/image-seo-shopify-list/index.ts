// image-seo-shopify-list — Paginated GraphQL listing of Shopify products + their images.
// Used by the "Shopify bulk" mode in the /image-seo flow to pick which products to optimize.
//
// POST { cursor?: string, query?: string, pageSize?: number }
// → { products: [{ id, handle, title, vendor, productType, images: [{ id, url, altText, width, height }] }],
//      pageInfo: { hasNextPage, endCursor } }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken, ShopifyReauthRequiredError } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QUERY = `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          handle
          title
          vendor
          productType
          tags
          images(first: 20) {
            edges { node { id url altText width height } }
          }
          variants(first: 1) { edges { node { sku } } }
        }
      }
    }
  }
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabaseUser = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let token, storeUrl, apiVersion;
    try {
      const result = await getValidShopifyToken(supabaseAdmin, user.id);
      token = result.accessToken;
      storeUrl = result.storeUrl;
      apiVersion = result.apiVersion || "2025-01";
    } catch (err) {
      if (err instanceof ShopifyReauthRequiredError) {
        return new Response(JSON.stringify({ error: "Shopify reconnect required", needs_reauth: true }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "No Shopify connection" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { cursor, query, pageSize } = await req.json().catch(() => ({}));
    const first = Math.min(Math.max(Number(pageSize) || 25, 1), 50);

    const resp = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: QUERY, variables: { first, after: cursor ?? null, query: query ?? null } }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: `Shopify ${resp.status}: ${text.slice(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    if (data.errors) {
      return new Response(JSON.stringify({ error: "Shopify GraphQL errors", details: data.errors }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const products = (data.data?.products?.edges || []).map((edge: { node: Record<string, unknown> }) => {
      const n = edge.node as {
        id: string; handle: string; title: string; vendor: string; productType: string; tags: string[];
        images: { edges: { node: Record<string, unknown> }[] };
        variants: { edges: { node: { sku: string } }[] };
      };
      return {
        id: n.id,
        handle: n.handle,
        title: n.title,
        vendor: n.vendor,
        productType: n.productType,
        tags: n.tags,
        sku: n.variants?.edges?.[0]?.node?.sku ?? null,
        images: (n.images?.edges || []).map((e) => e.node),
      };
    });

    return new Response(JSON.stringify({
      products,
      pageInfo: data.data?.products?.pageInfo ?? { hasNextPage: false, endCursor: null },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("image-seo-shopify-list error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
