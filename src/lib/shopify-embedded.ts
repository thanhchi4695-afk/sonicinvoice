/**
 * Shopify Embedded App utilities
 * Detects if the app is running inside Shopify Admin iframe
 * and provides helpers for App Bridge integration.
 */

/** Check if the app is running inside a Shopify Admin iframe or dev mode is on */
export function isShopifyEmbedded(): boolean {
  try {
    // Dev mode toggle overrides detection
    if (localStorage.getItem("dev_embedded_mode") === "true") return true;
    // Only consider embedded when Shopify's shop + host params are present
    const params = new URLSearchParams(window.location.search);
    const hasShopParam = !!params.get("shop");
    const hasHostParam = !!params.get("host");
    return hasShopParam && hasHostParam;
  } catch {
    return false;
  }
}

/** Get/set dev embedded mode */
export function getDevEmbeddedMode(): boolean {
  return localStorage.getItem("dev_embedded_mode") === "true";
}
export function setDevEmbeddedMode(on: boolean): void {
  localStorage.setItem("dev_embedded_mode", on ? "true" : "false");
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
