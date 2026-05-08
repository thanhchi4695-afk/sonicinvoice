import { supabase } from "@/integrations/supabase/client";

const FUNCTION_TIMEOUT_MS = 12000;

function withFunctionTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), FUNCTION_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface ShopifyConnection {
  id: string;
  store_url: string;
  api_version: string;
  default_location_id: string | null;
  product_status: string;
  shop_name: string | null;
}

export interface PushProduct {
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  status?: string;
  tags?: string;
  variants: PushVariant[];
  options?: { name: string }[];
  images?: { src: string }[];
}

export interface PushVariant {
  option1?: string;
  option2?: string;
  sku?: string;
  price: string;
  compare_at_price?: string;
  cost?: string;
  inventory_management?: string;
  inventory_quantity?: number;
}

export interface PushResult {
  title: string;
  status: "success" | "error" | "pending" | "pushing";
  error?: string;
  shopifyId?: string;
  handle?: string;
}

async function callProxy(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("shopify-proxy", {
    body,
  });
  if (error) throw new Error(error.message || "Shopify API call failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function initiateOAuth(shop: string): Promise<string> {
  const { data, error } = await withFunctionTimeout(
    supabase.functions.invoke("shopify-oauth", {
      body: { shop },
    }),
    "Shopify connection",
  );
  if (error) throw new Error(error.message || "Failed to start OAuth");
  if (data?.error) throw new Error(data.error);
  if (!data?.install_url) throw new Error("Shopify did not return an authorization URL");
  return data.install_url;
}

export async function testConnection(): Promise<{ shopName: string; storeUrl: string }> {
  const data = await callProxy({ action: "test" });
  return {
    shopName: data.shop?.name || "Unknown",
    storeUrl: data.shop?.myshopify_domain || data.shop?.domain || "",
  };
}

export async function getLocations(): Promise<{ id: string; name: string; active: boolean }[]> {
  const data = await callProxy({ action: "get_locations" });
  return (data.locations || []).map((l: Record<string, unknown>) => ({
    id: String(l.id),
    name: String(l.name || ""),
    active: Boolean(l.active),
  }));
}

export async function pushProduct(product: PushProduct): Promise<{ id: string }> {
  const data = await callProxy({ action: "push_product", product });
  return { id: String(data.product?.id || "") };
}

export async function pushProductGraphQL(product: PushProduct): Promise<{ id: string; handle?: string }> {
  const data = await callProxy({ action: "graphql_create_product", product });
  const gqlId = data.product?.id || "";
  // Extract numeric ID from GID format: gid://shopify/Product/12345
  const numericId = String(gqlId).split("/").pop() || String(gqlId);
  return { id: numericId, handle: data.product?.handle };
}

export async function getConnection(): Promise<ShopifyConnection | null> {
  const { data } = await supabase
    .from("shopify_connections")
    .select("id, store_url, api_version, default_location_id, product_status, shop_name")
    .maybeSingle();
  return data as ShopifyConnection | null;
}

export async function saveConnection(
  storeUrl: string,
  accessToken: string,
  apiVersion: string = "2024-10"
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const cleanStoreUrl = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const updatedAt = new Date().toISOString();

  const [{ error: shopifyError }, { error: platformDeleteError }, { error: platformInsertError }] = await Promise.all([
    supabase
      .from("shopify_connections")
      .upsert({
        user_id: user.id,
        store_url: cleanStoreUrl,
        access_token: accessToken,
        api_version: apiVersion,
        updated_at: updatedAt,
      }, { onConflict: "user_id" }),
    supabase
      .from("platform_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("platform", "shopify"),
    supabase
      .from("platform_connections")
      .insert({
        user_id: user.id,
        platform: "shopify",
        shop_domain: cleanStoreUrl,
        access_token: accessToken,
        is_active: true,
      }),
  ]);

  if (shopifyError) throw new Error(shopifyError.message);
  if (platformDeleteError) throw new Error(platformDeleteError.message);
  if (platformInsertError) throw new Error(platformInsertError.message);
}

export async function updateConnectionSettings(
  settings: { default_location_id?: string; product_status?: string }
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("shopify_connections")
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function deleteConnection(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const [{ error: shopifyError }, { error: platformError }] = await Promise.all([
    supabase
      .from("shopify_connections")
      .delete()
      .eq("user_id", user.id),
    supabase
      .from("platform_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("platform", "shopify"),
  ]);

  if (shopifyError) throw new Error(shopifyError.message);
  if (platformError) throw new Error(platformError.message);
}

export async function recordPush(
  storeUrl: string,
  created: number,
  updated: number,
  errors: number,
  summary: string,
  source: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("shopify_push_history").insert({
    user_id: user.id,
    store_url: storeUrl,
    products_created: created,
    products_updated: updated,
    errors,
    summary,
    source,
  });
}

export async function pushProducts(
  products: PushProduct[],
  productStatus: string,
  onProgress: (results: PushResult[]) => void
): Promise<PushResult[]> {
  const results: PushResult[] = products.map((p) => ({
    title: p.title,
    status: "pending" as const,
  }));

  onProgress([...results]);

  for (let i = 0; i < products.length; i++) {
    results[i].status = "pushing";
    onProgress([...results]);

    try {
      const product = { ...products[i], status: productStatus };
      const { id } = await pushProduct(product);
      results[i] = { title: products[i].title, status: "success", shopifyId: id };
    } catch (err) {
      results[i] = {
        title: products[i].title,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }

    onProgress([...results]);

    // Rate limit: 500ms between requests
    if (i < products.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/* ─── Collections ─── */
export interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
  body_html: string | null;
  image: { src: string } | null;
  sort_order: string;
  published_at: string | null;
  template_suffix: string | null;
  created_at: string;
  updated_at: string;
  // Smart collection fields
  rules?: { column: string; relation: string; condition: string }[];
  disjunctive?: boolean;
}

export async function getCustomCollections(): Promise<ShopifyCollection[]> {
  const data = await callProxy({ action: "get_custom_collections" });
  return data.collections || [];
}

export async function getSmartCollections(): Promise<ShopifyCollection[]> {
  const data = await callProxy({ action: "get_smart_collections" });
  return data.collections || [];
}

export async function createCustomCollection(collection: Record<string, unknown>): Promise<ShopifyCollection> {
  const data = await callProxy({ action: "create_custom_collection", collection });
  return data.collection;
}

export async function updateCustomCollection(collectionId: number, collection: Record<string, unknown>): Promise<ShopifyCollection> {
  const data = await callProxy({ action: "update_custom_collection", collection_id: collectionId, collection });
  return data.collection;
}

export async function createSmartCollection(collection: Record<string, unknown>): Promise<ShopifyCollection> {
  const data = await callProxy({ action: "create_smart_collection", collection });
  return data.collection;
}

export interface GraphQLCollectionInput {
  title: string;
  handle?: string;
  descriptionHtml?: string;
  seo?: { title?: string; description?: string };
  ruleSet?: {
    appliedDisjunctively: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  };
  metafields?: Array<{ namespace: string; key: string; value: string; type: string }>;
}

export async function createCollectionGraphQL(gql_collection: GraphQLCollectionInput) {
  const data = await callProxy({ action: "graphql_create_collection" as any, gql_collection } as any);
  return data.collection;
}

export async function updateSmartCollection(collectionId: number, collection: Record<string, unknown>): Promise<ShopifyCollection> {
  const data = await callProxy({ action: "update_smart_collection", collection_id: collectionId, collection });
  return data.collection;
}

export async function updateCollectionSEO(
  collectionId: number,
  collectionType: "custom" | "smart",
  seo: { body_html?: string; meta_title?: string; meta_description?: string }
): Promise<ShopifyCollection> {
  const data = await callProxy({
    action: "update_collection_seo",
    collection_id: collectionId,
    collection_type: collectionType === "smart" ? "smart" : "custom",
    ...seo,
  });
  return data.collection;
}

/* ─── GraphQL Catalog Search (for stock classification) ─── */

export interface CatalogSearchVariant {
  id: string;
  sku: string;
  title: string;
  barcode: string;
  inventoryQuantity: number;
  inventoryItemId: string;
  price: string;
  product: {
    id: string;
    title: string;
    handle: string;
    vendor: string;
    productType: string;
    options: { name: string; values: string[] }[];
  };
}

/**
 * Search Shopify catalog via GraphQL for candidate matches.
 * Builds a compound query from SKUs, barcodes, and title fragments.
 * Returns up to 50 matching variants per call.
 */
export async function searchShopifyCatalog(
  searchTerms: string[],
): Promise<CatalogSearchVariant[]> {
  const uniqueTerms = [...new Set(searchTerms.filter(Boolean).map(t => t.trim()))].slice(0, 20);
  if (uniqueTerms.length === 0) return [];

  const searchString = uniqueTerms
    .map(term => `sku:${term} OR barcode:${term} OR title:*${term}*`)
    .join(" OR ");

  const data = await callProxy({
    action: "graphql_search_catalog",
    query_string: searchString,
  });

  return (data.variants || []).map((v: Record<string, unknown>) => ({
    id: v.id || "",
    sku: v.sku || "",
    title: v.title || "",
    barcode: v.barcode || "",
    inventoryQuantity: v.inventoryQuantity || 0,
    inventoryItemId: v.inventoryItemId || "",
    price: v.price || "0.00",
    product: v.product || { id: "", title: "", handle: "", vendor: "", productType: "", options: [] },
  }));
}

/* ─── Inventory Sync ─── */

export interface ShopifyVariantMatch {
  variant_id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  cost: string | null;
  inventory_item_id: string;
  product_id: string;
  product_title: string;
  vendor: string | null;
}

export async function findVariantBySKU(sku: string): Promise<ShopifyVariantMatch | null> {
  const data = await callProxy({ action: "find_variant", sku });
  return data.variant || null;
}

export async function findVariantByBarcode(barcode: string): Promise<ShopifyVariantMatch[]> {
  const data = await callProxy({ action: "find_by_barcode", barcode });
  return data.variants || [];
}

export async function getInventoryLevels(locationId: string): Promise<{ inventory_item_id: string; available: number; location_id: string }[]> {
  const data = await callProxy({ action: "get_inventory_levels", location_id: locationId });
  return data.inventory_levels || [];
}

export async function adjustInventory(locationId: string, inventoryItemId: string, adjustment: number): Promise<void> {
  await callProxy({
    action: "adjust_inventory",
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available_adjustment: adjustment,
  });
}

export async function setInventory(locationId: string, inventoryItemId: string, available: number): Promise<void> {
  await callProxy({
    action: "set_inventory" as any,
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available,
  } as any);
}

export async function updateVariantCost(variantId: string, cost: string): Promise<void> {
  await callProxy({ action: "update_variant_cost", variant_id: variantId, cost });
}

export async function updateVariantPrice(
  variantId: string,
  price: string,
  compareAtPrice?: string | null,
): Promise<void> {
  await callProxy({
    action: "update_variant_price",
    variant_id: variantId,
    price,
    compare_at_price: compareAtPrice ?? null,
  });
}

export async function getProductsPage(pageInfo?: string, limit: number = 250): Promise<{
  products: Array<{
    id: number;
    title: string;
    handle: string;
    vendor: string;
    product_type: string;
    tags: string;
    variants: Array<{
      id: number;
      sku: string | null;
      barcode: string | null;
      price: string;
      inventory_item_id: number;
      inventory_quantity: number;
    }>;
    images: Array<{ src: string }>;
  }>;
  nextPageInfo: string | null;
}> {
  const data = await callProxy({ action: "get_products_page", page_info: pageInfo, limit });
  return { products: data.products || [], nextPageInfo: data.nextPageInfo || null };
}

/* ─── Image Alt Text Sync ─── */

export async function updateImageAlt(
  updates: Array<{ shopify_product_id: string; alt_text: string; seo_filename?: string; keywords?: string[] }>
): Promise<{ shopify_product_id: string; status: string; error?: string }[]> {
  const data = await callProxy({ action: "update_image_alt", image_updates: updates });
  return data.results || [];
}
