/**
 * Shopify Session Token helpers for embedded app authentication.
 *
 * ═══ Where session token is acquired ═══
 * App Bridge v4 exposes window.shopify.idToken() when running embedded.
 * We use that to get a fresh session token for every backend request.
 */

import { isShopifyEmbedded } from "./shopify-embedded";

/**
 * Wait until App Bridge v4 is loaded and `window.shopify.idToken` is available.
 * The CDN script is injected from main.tsx but takes a few hundred ms to
 * register `window.shopify`. Calling `idToken()` before that races to undefined
 * and falsely surfaces "Embedded auth failed".
 */
async function waitForAppBridge(timeoutMs = 8000): Promise<unknown | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sh = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
    if (sh && typeof sh.idToken === "function") return sh;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Get a Shopify session token from App Bridge v4.
 * Returns null when not embedded or App Bridge never loads.
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    if (!isShopifyEmbedded()) return null;

    const shopify = (await waitForAppBridge()) as { idToken: () => Promise<string> } | null;
    if (!shopify) {
      console.warn("[session-token] App Bridge did not load within timeout");
      return null;
    }

    // ═══ Where session token is acquired ═══
    const token: string = await shopify.idToken();
    return token || null;
  } catch (err) {
    console.warn("[session-token] Failed to get session token:", err);
    return null;
  }
}

/**
 * Build authorization headers for backend requests.
 * When embedded, attaches the Shopify session token as a Bearer token.
 * When standalone, returns empty headers (Supabase auth handles it).
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  if (token) {
    // ═══ Where session token is sent ═══
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/**
 * Authenticated fetch wrapper for embedded mode.
 * Automatically attaches the session token to requests.
 * Falls back to normal fetch in standalone mode.
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> || {}),
    },
  });
}
