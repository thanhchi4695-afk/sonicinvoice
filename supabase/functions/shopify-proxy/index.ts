import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
// ═══ Session token verification import ═══
import { verifyShopifySessionToken, extractShopDomain } from "../_shared/verify-session-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShopifyRequestBody {
  action: "test" | "get_locations" | "push_product" | "find_variant" | "adjust_inventory" | "update_seo" | "graphql_create_product";
  // For push_product / graphql_create_product
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
    // ═══ Authentication: support both Supabase JWT and Shopify session token ═══
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let userId: string | null = null;

    const bearerToken = authHeader.replace("Bearer ", "");

    // Try Shopify session token first (embedded mode)
    const sessionPayload = await verifyShopifySessionToken(bearerToken);
    if (sessionPayload) {
      // ═══ Session token validated — look up user by shop ═══
      const shop = extractShopDomain(sessionPayload.dest || sessionPayload.iss);
      const { data: conn } = await supabaseAdmin
        .from("shopify_connections")
        .select("user_id")
        .eq("store_url", shop)
        .single();
      if (conn) userId = conn.user_id;
    }

    // Fallback: standard Supabase JWT auth (standalone mode)
    if (!userId) {
      const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's Shopify connection
    const { data: conn, error: connError } = await supabaseAdmin
      .from("shopify_connections")
      .select("*")
      .eq("user_id", userId)
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
            .eq("user_id", userId);
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

      case "graphql_create_product": {
        if (!body.product) {
          return new Response(JSON.stringify({ error: "Missing product data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const p = body.product as Record<string, unknown>;
        const variants = (p.variants as Record<string, unknown>[]) || [];
        const options = (p.options as { name: string }[]) || [];
        const images = (p.images as { src: string }[]) || [];

        const variantInputs = variants.map((v: Record<string, unknown>) => {
          const optionValues: string[] = [];
          if (v.option1) optionValues.push(String(v.option1));
          if (v.option2) optionValues.push(String(v.option2));

          return `{
            price: "${v.price || "0.00"}"
            ${v.compare_at_price ? `compareAtPrice: "${v.compare_at_price}"` : ""}
            ${v.sku ? `sku: "${v.sku}"` : ""}
            ${v.cost ? `inventoryItem: { cost: "${v.cost}" }` : ""}
            ${v.inventory_management === "shopify" ? `inventoryManagement: SHOPIFY` : ""}
            ${optionValues.length > 0 ? `optionValues: [${optionValues.map(ov => `{ name: "${ov}", optionName: "${options[optionValues.indexOf(ov)]?.name || "Option"}" }`).join(", ")}]` : ""}
          }`;
        });

        const mutation = `
          mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
            productCreate(input: $input, media: $media) {
              product {
                id
                title
                handle
                status
                onlineStoreUrl
                variants(first: 10) {
                  edges {
                    node {
                      id
                      sku
                      price
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const productInput: Record<string, unknown> = {
          title: p.title || "",
          descriptionHtml: p.body_html || "",
          vendor: p.vendor || "",
          productType: p.product_type || "",
          status: (p.status || "DRAFT").toUpperCase(),
          tags: p.tags ? (p.tags as string).split(",").map((t: string) => t.trim()) : [],
        };

        // Build variants for GraphQL input
        if (variants.length > 0) {
          productInput.variants = variants.map((v: Record<string, unknown>) => {
            const variant: Record<string, unknown> = {
              price: String(v.price || "0.00"),
            };
            if (v.compare_at_price) variant.compareAtPrice = String(v.compare_at_price);
            if (v.sku) variant.sku = String(v.sku);
            if (v.cost) variant.inventoryItem = { cost: String(v.cost) };
            if (v.inventory_management === "shopify") variant.inventoryManagement = "SHOPIFY";
            const optVals: { name: string; optionName: string }[] = [];
            if (v.option1 && options[0]) optVals.push({ name: String(v.option1), optionName: options[0].name });
            if (v.option2 && options[1]) optVals.push({ name: String(v.option2), optionName: options[1].name });
            if (optVals.length > 0) variant.optionValues = optVals;
            return variant;
          });
        }

        const mediaInput = images.map((img: { src: string }) => ({
          originalSource: img.src,
          mediaContentType: "IMAGE",
        }));

        const graphqlResp = await fetch(`${baseUrl.replace(`/api/${conn.api_version}`, "")}/admin/api/${conn.api_version}/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": access_token,
          },
          body: JSON.stringify({
            query: mutation,
            variables: {
              input: productInput,
              media: mediaInput.length > 0 ? mediaInput : undefined,
            },
          }),
        });

        const graphqlData = await graphqlResp.json();

        if (graphqlData.errors) {
          return new Response(JSON.stringify({
            error: "GraphQL errors",
            details: graphqlData.errors,
          }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const productResult = graphqlData.data?.productCreate;
        if (productResult?.userErrors?.length > 0) {
          return new Response(JSON.stringify({
            error: productResult.userErrors.map((e: { message: string }) => e.message).join(", "),
            details: productResult.userErrors,
          }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        result = { product: productResult?.product };
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
