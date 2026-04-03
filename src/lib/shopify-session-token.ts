/**
 * Shopify Session Token helpers for embedded app authentication.
 *
 * ═══ Where session token is acquired ═══
 * App Bridge v4 exposes window.shopify.idToken() when running embedded.
 * We use that to get a fresh session token for every backend request.
 */

import { isShopifyEmbedded } from "./shopify-embedded";

/**
 * Get a Shopify session token from App Bridge v4.
 * Returns null when not embedded or App Bridge is unavailable.
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    if (!isShopifyEmbedded()) return null;

    // App Bridge v4 CDN exposes window.shopify
    const shopify = (window as any).shopify;
    if (!shopify?.idToken) return null;

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
