/**
 * Shopify Session Token helpers for embedded app authentication.
 *
 * ═══ Where session token is acquired ═══
 * App Bridge v4 exposes window.shopify.idToken() when running embedded.
 * We use that to get a fresh session token for every backend request.
 */

import { isShopifyEmbedded } from "./shopify-embedded";

function getTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("id_token");
    if (!token) return null;
    return token.split(".").length === 3 ? token : null;
  } catch {
    return null;
  }
}

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

    const urlToken = getTokenFromUrl();
    if (urlToken) return urlToken;

    const shopify = (await waitForAppBridge()) as { idToken: () => Promise<string> } | null;
    if (!shopify) {
      console.warn("[session-token] App Bridge did not load within timeout");
      return null;
    }

    // ═══ Where session token is acquired ═══
    // Race the idToken() call against a 6s timeout. App Bridge can occasionally
    // hang here (third-party cookie blocks, race with admin reload), and we
    // never want to leave the embedded auth provider stuck on "loading".
    const tokenPromise = shopify.idToken();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 6000)
    );
    const token = (await Promise.race([tokenPromise, timeoutPromise])) as string | null;
    if (!token) {
      console.warn("[session-token] idToken() did not resolve within timeout");
      return null;
    }
    return token;
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
