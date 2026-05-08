import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n/config";

const PRIMARY_SHOPIFY_API_KEY = "aebbc68f4f67197beb20489d6d2987e4";
const KNOWN_SHOPIFY_API_KEYS = [PRIMARY_SHOPIFY_API_KEY, "8277057587c9b97483827190f085fe6d"];

function resolveShopifyApiKey() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop")?.toLowerCase();
  if (shop === "splashswimweardarwin.myshopify.com") return "8277057587c9b97483827190f085fe6d";

  const explicitKey = params.get("client_id") || params.get("api_key") || params.get("app_key");
  if (explicitKey && KNOWN_SHOPIFY_API_KEYS.includes(explicitKey)) return explicitKey;
  const sources = [window.location.href, document.referrer].filter(Boolean);
  return KNOWN_SHOPIFY_API_KEYS.find((key) => sources.some((source) => source.includes(key))) || import.meta.env.VITE_SHOPIFY_API_KEY || PRIMARY_SHOPIFY_API_KEY;
}

// ═══ Set Shopify API key meta tag before App Bridge reads it ═══
const apiKeyMeta = document.getElementById("shopify-api-key-meta");
if (apiKeyMeta) {
  apiKeyMeta.setAttribute("content", resolveShopifyApiKey());
}

// ═══ Load Shopify App Bridge ONLY when running embedded inside Shopify Admin ═══
// Loading it on every page caused "missing required configuration fields: shop"
// errors on the public marketing site / standalone preview.
(function loadAppBridgeIfEmbedded() {
  try {
    const params = new URLSearchParams(window.location.search);
    const isEmbedded = !!params.get("shop") && !!params.get("host");
    if (!isEmbedded) return;
    if (document.querySelector('script[src*="cdn.shopify.com/shopifycloud/app-bridge.js"]')) return;
    const s = document.createElement("script");
    s.src = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
    s.async = false; // App Bridge expects synchronous-ish ordering
    document.head.appendChild(s);
  } catch {
    // No-op
  }
})();

createRoot(document.getElementById("root")!).render(<App />);

// ═══ Service Worker registration (production only, never in iframes/previews) ═══
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if ("serviceWorker" in navigator && !isInIframe && !isPreviewHost) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
} else if (isPreviewHost || isInIframe) {
  // Unregister any stale SW in preview/iframe contexts
  navigator.serviceWorker?.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  );
}
/* site recovery Sun 26 Apr 2026 09:40:26 ACST */
