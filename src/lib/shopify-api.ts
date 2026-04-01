import { supabase } from "@/integrations/supabase/client";

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
}

async function callProxy(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("shopify-proxy", {
    body,
  });
  if (error) throw new Error(error.message || "Shopify API call failed");
  if (data?.error) throw new Error(data.error);
  return data;
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

  const { error } = await supabase
    .from("shopify_connections")
    .upsert({
      user_id: user.id,
      store_url: storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      access_token: accessToken,
      api_version: apiVersion,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
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

  const { error } = await supabase
    .from("shopify_connections")
    .delete()
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
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
