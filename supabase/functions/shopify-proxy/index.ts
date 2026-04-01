import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShopifyRequestBody {
  action: "test" | "get_locations" | "push_product" | "find_variant" | "adjust_inventory" | "update_seo";
  // For push_product
  product?: Record<string, unknown>;
  // For find_variant
  sku?: string;
  // For adjust_inventory
  location_id?: string;
  inventory_item_id?: string;
  available_adjustment?: number;
  // For update_seo
  product_id?: string;
  seo_title?: string;
  seo_description?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's Shopify connection
    const { data: conn, error: connError } = await supabaseAdmin
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (connError || !conn) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ShopifyRequestBody = await req.json();
    const { store_url, access_token, api_version } = conn;
    const baseUrl = `https://${store_url}/admin/api/${api_version}`;

    const shopifyFetch = async (path: string, options: RequestInit = {}) => {
      const resp = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": access_token,
          ...((options.headers as Record<string, string>) || {}),
        },
      });

      if (resp.status === 429) {
        // Rate limited — wait and retry once
        await new Promise((r) => setTimeout(r, 2000));
        return fetch(`${baseUrl}${path}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": access_token,
            ...((options.headers as Record<string, string>) || {}),
          },
        });
      }

      return resp;
    };

    let result: unknown;

    switch (body.action) {
      case "test": {
        const resp = await shopifyFetch("/shop.json");
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Connection failed", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Update shop_name in connection
        if (data.shop?.name) {
          await supabaseAdmin
            .from("shopify_connections")
            .update({ shop_name: data.shop.name, updated_at: new Date().toISOString() })
            .eq("user_id", user.id);
        }
        result = { shop: data.shop };
        break;
      }

      case "get_locations": {
        const resp = await shopifyFetch("/locations.json");
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to fetch locations", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { locations: data.locations };
        break;
      }

      case "push_product": {
        if (!body.product) {
          return new Response(JSON.stringify({ error: "Missing product data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch("/products.json", {
          method: "POST",
          body: JSON.stringify({ product: body.product }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to create product", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { product: data.product };
        break;
      }

      case "find_variant": {
        if (!body.sku) {
          return new Response(JSON.stringify({ error: "Missing SKU" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch(`/variants.json?fields=id,sku,inventory_item_id&limit=1`);
        // Shopify doesn't support SKU filter on variants endpoint directly
        // Use products search instead
        const searchResp = await shopifyFetch(`/products.json?fields=id,variants&limit=250`);
        const searchData = await searchResp.json();
        let found = null;
        if (searchData.products) {
          for (const p of searchData.products) {
            for (const v of p.variants || []) {
              if (v.sku === body.sku) {
                found = { variant_id: v.id, inventory_item_id: v.inventory_item_id, product_id: p.id };
                break;
              }
            }
            if (found) break;
          }
        }
        result = { variant: found };
        break;
      }

      case "adjust_inventory": {
        if (!body.location_id || !body.inventory_item_id) {
          return new Response(JSON.stringify({ error: "Missing inventory parameters" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch("/inventory_levels/adjust.json", {
          method: "POST",
          body: JSON.stringify({
            location_id: body.location_id,
            inventory_item_id: body.inventory_item_id,
            available_adjustment: body.available_adjustment || 0,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to adjust inventory", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { inventory_level: data.inventory_level };
        break;
      }

      case "update_seo": {
        if (!body.product_id) {
          return new Response(JSON.stringify({ error: "Missing product ID" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch(`/products/${body.product_id}.json`, {
          method: "PUT",
          body: JSON.stringify({
            product: {
              id: body.product_id,
              metafields_global_title_tag: body.seo_title || "",
              metafields_global_description_tag: body.seo_description || "",
            },
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to update SEO", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { product: data.product };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Shopify proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
