/**
 * Shopify Embedded App utilities
 * Detects if the app is running inside Shopify Admin iframe
 * and provides helpers for App Bridge integration.
 */

/** Check if the app is running inside a Shopify Admin iframe */
export function isShopifyEmbedded(): boolean {
  try {
    // Only consider embedded when Shopify's shop + host params are present
    const params = new URLSearchParams(window.location.search);
    const hasShopParam = !!params.get("shop");
    const hasHostParam = !!params.get("host");
    return hasShopParam && hasHostParam;
  } catch {
    return false;
  }
}

/** Extract the shop domain from URL params */
export function getShopFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("shop");
}

/** Extract the host param (base64-encoded) for App Bridge */
export function getHostFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("host");
}

/** Get the Shopify API key from env */
export function getApiKey(): string {
  return import.meta.env.VITE_SHOPIFY_API_KEY || "";
}
