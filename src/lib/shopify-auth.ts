import { supabase } from "@/integrations/supabase/client";

/**
 * Initiate Shopify OAuth login flow.
 * Returns the Shopify authorization URL to redirect to.
 */
export async function initiateShopifyLogin(shop: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("shopify-auth", {
    body: { shop },
  });
  if (error) throw new Error(error.message || "Failed to start Shopify login");
  if (data?.error) throw new Error(data.error);
  return data.install_url;
}

/**
 * Exchange a one-time login token (from OAuth callback) for a Supabase session.
 */
export async function exchangeShopifyToken(token: string): Promise<{
  shop: string;
  success: boolean;
}> {
  const { data, error } = await supabase.functions.invoke("shopify-auth", {
    body: { token },
    headers: { "x-action": "exchange" },
  });

  // The edge function uses ?action=exchange, but supabase.functions.invoke
  // doesn't support query params, so we call it differently
  // Actually, let's use a direct fetch
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopify-auth?action=exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }
  );

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ error: "Exchange failed" }));
    throw new Error(errData.error || "Token exchange failed");
  }

  const result = await resp.json();

  if (result.access_token && result.refresh_token) {
    // Set the session in Supabase client
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (sessionError) {
      console.error("Failed to set session:", sessionError);
      throw new Error("Failed to establish session");
    }
    return { shop: result.shop, success: true };
  }

  throw new Error("No session tokens received");
}
