import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// ═══ Session token verification import ═══
import { verifyShopifySessionToken, extractShopDomain } from "../_shared/verify-session-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShopifyRequestBody {
  action: "test" | "get_locations" | "push_product" | "find_variant" | "find_by_barcode" | "get_inventory_levels" | "update_variant_cost" | "adjust_inventory" | "update_seo" | "graphql_create_product" | "get_custom_collections" | "get_smart_collections" | "create_custom_collection" | "update_custom_collection" | "create_smart_collection" | "update_smart_collection" | "update_collection_seo" | "get_products_page" | "set_metafields" | "update_image_alt" | "replace_product_image" | "batch_lookup" | "graphql_adjust_inventory" | "graphql_create_variant";
  // For push_product / graphql_create_product
  product?: Record<string, unknown>;
  // For find_variant / find_by_barcode
  sku?: string;
  barcode?: string;
  // For update_variant_cost
  variant_id?: string;
  cost?: string;
  // For adjust_inventory
  location_id?: string;
  inventory_item_id?: string;
  available_adjustment?: number;
  // For update_seo
  product_id?: string;
  seo_title?: string;
  seo_description?: string;
  // For collection operations
  collection?: Record<string, unknown>;
  collection_id?: number;
  // For update_collection_seo
  collection_type?: string;
  body_html?: string;
  meta_title?: string;
  meta_description?: string;
  // For get_products_page
  page_info?: string;
  limit?: number;
  fields?: string;
  // For set_metafields
  metafields?: Array<{ ownerId: string; namespace: string; key: string; value: string; type: string }>;
  // For update_image_alt (batch)
  image_updates?: Array<{ shopify_product_id: string; alt_text: string; seo_filename?: string; keywords?: string[] }>;
  // For replace_product_image (batch)
  image_replacements?: Array<{ shopify_product_id: string; image_base64: string; alt_text?: string; filename?: string }>;
  // For batch_lookup (stock check)
  lookup_items?: Array<{ sku?: string; barcode?: string; stylePrefix?: string; titleQuery?: string }>;
  // For graphql_adjust_inventory
  inventory_changes?: Array<{ inventoryItemId: string; locationId: string; delta: number }>;
  reference_document_uri?: string;
  // For graphql_create_variant
  product_id_gid?: string;
  new_variants?: Array<{ price: string; sku?: string; barcode?: string; options: string[]; qty?: number; locationId?: string; cost?: string; imageSrc?: string }>;
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
      const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
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

      case "get_custom_collections": {
        const allCollections: unknown[] = [];
        let pageInfo: string | null = null;
        do {
          const url = pageInfo
            ? `/custom_collections.json?limit=250&page_info=${pageInfo}`
            : "/custom_collections.json?limit=250";
          const resp = await shopifyFetch(url);
          const data = await resp.json();
          if (!resp.ok) {
            return new Response(JSON.stringify({ error: "Failed to fetch custom collections", details: data }), {
              status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          allCollections.push(...(data.custom_collections || []));
          const linkHeader = resp.headers.get("link") || "";
          const nextMatch = linkHeader.match(/page_info=([^>&]+)>;\s*rel="next"/);
          pageInfo = nextMatch ? nextMatch[1] : null;
        } while (pageInfo);
        result = { collections: allCollections };
        break;
      }

      case "get_smart_collections": {
        const allSmarts: unknown[] = [];
        let smartPageInfo: string | null = null;
        do {
          const url = smartPageInfo
            ? `/smart_collections.json?limit=250&page_info=${smartPageInfo}`
            : "/smart_collections.json?limit=250";
          const resp = await shopifyFetch(url);
          const data = await resp.json();
          if (!resp.ok) {
            return new Response(JSON.stringify({ error: "Failed to fetch smart collections", details: data }), {
              status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          allSmarts.push(...(data.smart_collections || []));
          const linkHeader = resp.headers.get("link") || "";
          const nextMatch = linkHeader.match(/page_info=([^>&]+)>;\s*rel="next"/);
          smartPageInfo = nextMatch ? nextMatch[1] : null;
        } while (smartPageInfo);
        result = { collections: allSmarts };
        break;
      }

      case "create_custom_collection": {
        if (!body.collection) {
          return new Response(JSON.stringify({ error: "Missing collection data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch("/custom_collections.json", {
          method: "POST",
          body: JSON.stringify({ custom_collection: body.collection }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to create collection", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { collection: data.custom_collection };
        break;
      }

      case "update_custom_collection": {
        if (!body.collection_id || !body.collection) {
          return new Response(JSON.stringify({ error: "Missing collection_id or collection data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch(`/custom_collections/${body.collection_id}.json`, {
          method: "PUT",
          body: JSON.stringify({ custom_collection: { id: body.collection_id, ...body.collection } }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to update collection", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { collection: data.custom_collection };
        break;
      }

      case "create_smart_collection": {
        if (!body.collection) {
          return new Response(JSON.stringify({ error: "Missing collection data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch("/smart_collections.json", {
          method: "POST",
          body: JSON.stringify({ smart_collection: body.collection }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to create smart collection", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { collection: data.smart_collection };
        break;
      }

      case "update_smart_collection": {
        if (!body.collection_id || !body.collection) {
          return new Response(JSON.stringify({ error: "Missing collection_id or collection data" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const resp = await shopifyFetch(`/smart_collections/${body.collection_id}.json`, {
          method: "PUT",
          body: JSON.stringify({ smart_collection: { id: body.collection_id, ...body.collection } }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to update smart collection", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { collection: data.smart_collection };
        break;
      }

      case "update_collection_seo": {
        if (!body.collection_id) {
          return new Response(JSON.stringify({ error: "Missing collection_id" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const isCustom = body.collection_type !== "smart";
        const endpoint = isCustom
          ? `/custom_collections/${body.collection_id}.json`
          : `/smart_collections/${body.collection_id}.json`;
        const key = isCustom ? "custom_collection" : "smart_collection";
        const payload: Record<string, unknown> = { id: body.collection_id };
        if (body.body_html !== undefined) payload.body_html = body.body_html;
        if (body.meta_title !== undefined) payload.metafields_global_title_tag = body.meta_title;
        if (body.meta_description !== undefined) payload.metafields_global_description_tag = body.meta_description;
        const resp = await shopifyFetch(endpoint, {
          method: "PUT",
          body: JSON.stringify({ [key]: payload }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to update collection SEO", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { collection: data[key] };
        break;
      }

      case "get_products_page": {
        const limit = body.limit || 250;
        const fieldsParam = body.fields || "id,title,handle,vendor,product_type,tags,variants,images";
        let url = `/products.json?limit=${limit}&fields=${fieldsParam}`;
        if (body.page_info) {
          url = `/products.json?limit=${limit}&page_info=${body.page_info}`;
        }
        const resp = await shopifyFetch(url);
        const data = await resp.json();
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: "Failed to fetch products", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Extract next page cursor from Link header
        const linkHeader = resp.headers.get("link") || "";
        const nextMatch = linkHeader.match(/page_info=([^>&]+)>;\s*rel="next"/);
        const nextPageInfo = nextMatch ? nextMatch[1] : null;
        result = { products: data.products || [], nextPageInfo };
        break;
      }

      case "set_metafields": {
        if (!body.metafields || body.metafields.length === 0) {
          return new Response(JSON.stringify({ error: "Missing metafields" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Use GraphQL metafieldsSet mutation
        const graphqlUrl = `https://${store_url}/admin/api/${conn.api_version}/graphql.json`;
        const mutation = `
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { key namespace value ownerId }
              userErrors { field message code }
            }
          }
        `;
        const gqlResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": access_token,
          },
          body: JSON.stringify({
            query: mutation,
            variables: { metafields: body.metafields },
          }),
        });
        const gqlData = await gqlResp.json();
        if (gqlData.errors) {
          return new Response(JSON.stringify({ error: "GraphQL errors", details: gqlData.errors }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const userErrors = gqlData.data?.metafieldsSet?.userErrors || [];
        if (userErrors.length > 0) {
          return new Response(JSON.stringify({ error: userErrors.map((e: any) => e.message).join(", "), details: userErrors }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { metafields: gqlData.data?.metafieldsSet?.metafields || [], success: true };
        break;
      }

      case "find_by_barcode": {
        if (!body.barcode) {
          return new Response(JSON.stringify({ error: "Missing barcode" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // GraphQL is the only reliable way to search by barcode
        const barcodeGqlUrl = `https://${store_url}/admin/api/${conn.api_version}/graphql.json`;
        const barcodeQuery = `{
          productVariants(first: 5, query: "barcode:${body.barcode}") {
            edges {
              node {
                id
                sku
                barcode
                price
                inventoryItem { id unitCost { amount currencyCode } }
                product { id title handle vendor }
              }
            }
          }
        }`;
        const barcodeResp = await fetch(barcodeGqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
          body: JSON.stringify({ query: barcodeQuery }),
        });
        const barcodeData = await barcodeResp.json();
        const barcodeEdges = barcodeData.data?.productVariants?.edges || [];
        const barcodeVariants = barcodeEdges.map((e: any) => ({
          variant_id: e.node.id,
          sku: e.node.sku,
          barcode: e.node.barcode,
          price: e.node.price,
          cost: e.node.inventoryItem?.unitCost?.amount || null,
          inventory_item_id: e.node.inventoryItem?.id,
          product_id: e.node.product?.id,
          product_title: e.node.product?.title,
          vendor: e.node.product?.vendor,
        }));
        result = { variants: barcodeVariants };
        break;
      }

      case "get_inventory_levels": {
        if (!body.location_id) {
          return new Response(JSON.stringify({ error: "Missing location_id" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const allLevels: unknown[] = [];
        let invPageInfo: string | null = null;
        do {
          const url = invPageInfo
            ? `/inventory_levels.json?limit=250&page_info=${invPageInfo}`
            : `/inventory_levels.json?location_ids=${body.location_id}&limit=250`;
          const resp = await shopifyFetch(url);
          const data = await resp.json();
          if (!resp.ok) {
            return new Response(JSON.stringify({ error: "Failed to fetch inventory", details: data }), {
              status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          allLevels.push(...(data.inventory_levels || []));
          const linkHeader = resp.headers.get("link") || "";
          const nextMatch = linkHeader.match(/page_info=([^>&]+)>;\s*rel="next"/);
          invPageInfo = nextMatch ? nextMatch[1] : null;
        } while (invPageInfo);
        result = { inventory_levels: allLevels };
        break;
      }

      case "update_variant_cost": {
        if (!body.variant_id || body.cost === undefined) {
          return new Response(JSON.stringify({ error: "Missing variant_id or cost" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Use GraphQL to update variant cost via inventoryItem
        const costGqlUrl = `https://${store_url}/admin/api/${conn.api_version}/graphql.json`;
        // First get the inventory item ID
        const getItemQuery = `{
          productVariant(id: "${body.variant_id}") {
            inventoryItem { id }
          }
        }`;
        const getItemResp = await fetch(costGqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
          body: JSON.stringify({ query: getItemQuery }),
        });
        const getItemData = await getItemResp.json();
        const inventoryItemId = getItemData.data?.productVariant?.inventoryItem?.id;
        if (!inventoryItemId) {
          return new Response(JSON.stringify({ error: "Variant not found" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const updateCostMutation = `
          mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { id unitCost { amount currencyCode } }
              userErrors { field message }
            }
          }
        `;
        const updateResp = await fetch(costGqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
          body: JSON.stringify({
            query: updateCostMutation,
            variables: { id: inventoryItemId, input: { cost: parseFloat(body.cost) } },
          }),
        });
        const updateData = await updateResp.json();
        const costErrors = updateData.data?.inventoryItemUpdate?.userErrors || [];
        if (costErrors.length > 0) {
          return new Response(JSON.stringify({ error: costErrors.map((e: any) => e.message).join(", ") }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = { inventoryItem: updateData.data?.inventoryItemUpdate?.inventoryItem, success: true };
        break;
      }

      case "update_image_alt": {
        if (!body.image_updates || body.image_updates.length === 0) {
          return new Response(JSON.stringify({ error: "Missing image_updates" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const results: { shopify_product_id: string; status: string; error?: string }[] = [];
        for (const update of body.image_updates) {
          try {
            // Get product images
            const imgResp = await shopifyFetch(`/products/${update.shopify_product_id}/images.json`);
            const imgData = await imgResp.json();
            if (!imgResp.ok || !imgData.images?.length) {
              results.push({ shopify_product_id: update.shopify_product_id, status: "error", error: "No images found" });
              continue;
            }
            // Update first image alt text
            const imageId = imgData.images[0].id;
            const putResp = await shopifyFetch(`/products/${update.shopify_product_id}/images/${imageId}.json`, {
              method: "PUT",
              body: JSON.stringify({ image: { id: imageId, alt: update.alt_text } }),
            });
            if (!putResp.ok) {
              const errData = await putResp.json();
              results.push({ shopify_product_id: update.shopify_product_id, status: "error", error: JSON.stringify(errData) });
            } else {
              results.push({ shopify_product_id: update.shopify_product_id, status: "success" });
            }
            // Rate limit
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            results.push({ shopify_product_id: update.shopify_product_id, status: "error", error: e instanceof Error ? e.message : "Unknown" });
          }
        }
        result = { results };
        break;
      }

      case "replace_product_image": {
        if (!body.image_replacements || body.image_replacements.length === 0) {
          return new Response(JSON.stringify({ error: "Missing image_replacements" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const replaceResults: { shopify_product_id: string; status: string; error?: string }[] = [];
        for (const rep of body.image_replacements) {
          try {
            // Get existing images
            const imgResp = await shopifyFetch(`/products/${rep.shopify_product_id}/images.json`);
            const imgData = await imgResp.json();

            // Upload new image with base64 attachment
            const newImage: Record<string, unknown> = {
              attachment: rep.image_base64,
              position: 1,
            };
            if (rep.alt_text) newImage.alt = rep.alt_text;
            if (rep.filename) newImage.filename = rep.filename;

            const postResp = await shopifyFetch(`/products/${rep.shopify_product_id}/images.json`, {
              method: "POST",
              body: JSON.stringify({ image: newImage }),
            });

            if (!postResp.ok) {
              const errData = await postResp.json();
              replaceResults.push({ shopify_product_id: rep.shopify_product_id, status: "error", error: JSON.stringify(errData) });
              await new Promise(r => setTimeout(r, 500));
              continue;
            }

            // Delete old primary image if it existed
            if (imgResp.ok && imgData.images?.length > 0) {
              const oldImageId = imgData.images[0].id;
              await shopifyFetch(`/products/${rep.shopify_product_id}/images/${oldImageId}.json`, { method: "DELETE" });
              await new Promise(r => setTimeout(r, 300));
            }

            replaceResults.push({ shopify_product_id: rep.shopify_product_id, status: "success" });
            await new Promise(r => setTimeout(r, 500));
          } catch (e) {
            replaceResults.push({ shopify_product_id: rep.shopify_product_id, status: "error", error: e instanceof Error ? e.message : "Unknown" });
          }
        }
        result = { results: replaceResults };
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
