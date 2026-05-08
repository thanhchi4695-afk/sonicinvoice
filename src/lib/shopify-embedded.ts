/**
 * Shopify Embedded App utilities
 * Detects if the app is running inside Shopify Admin iframe
 * and provides helpers for App Bridge integration.
 */

/** Check if the app is running inside a Shopify Admin iframe or dev mode is on */
export function isShopifyEmbedded(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const hasShopParam = !!params.get("shop");
    const hasHostParam = !!params.get("host");

    // Dev mode toggle overrides detection — but ONLY when shop+host params
    // are also present. Without them, App Bridge can't initialise and the
    // app gets stuck on "Embedded auth failed". This protects against the
    // flag being left on after testing.
    if (localStorage.getItem("dev_embedded_mode") === "true") {
      if (hasShopParam && hasHostParam) return true;
      // Auto-clear stale dev flag — there's no shop context to authenticate against.
      console.warn("[shopify-embedded] dev_embedded_mode was on but no shop/host params — clearing");
      localStorage.removeItem("dev_embedded_mode");
      return false;
    }

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

const PRIMARY_SHOPIFY_API_KEY = "aebbc68f4f67197beb20489d6d2987e4";
const KNOWN_SHOPIFY_API_KEYS = [
  PRIMARY_SHOPIFY_API_KEY,
  // Splash Swimwear custom app client ID (public App Bridge identifier, not a secret).
  "8277057587c9b97483827190f085fe6d",
];

function getApiKeyFromUrlOrReferrer(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const explicitKey = params.get("client_id") || params.get("api_key") || params.get("app_key");
  if (explicitKey && KNOWN_SHOPIFY_API_KEYS.includes(explicitKey)) return explicitKey;

  const sources = [window.location.href, document.referrer].filter(Boolean);
  for (const source of sources) {
    for (const key of KNOWN_SHOPIFY_API_KEYS) {
      if (source.includes(key)) return key;
    }
  }

  return null;
}

/** Get the Shopify API key from env or the hardcoded meta tag */
export function getApiKey(): string {
  const requestKey = getApiKeyFromUrlOrReferrer();
  if (requestKey) return requestKey;

  const envKey = import.meta.env.VITE_SHOPIFY_API_KEY;
  if (envKey) return envKey;

  if (typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="shopify-api-key"]');
    return meta?.content || "";
  }

  return "";
}
