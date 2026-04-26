import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n/config";

// ═══ Set Shopify API key meta tag at runtime for App Bridge ═══
const apiKeyMeta = document.getElementById("shopify-api-key-meta");
if (apiKeyMeta && import.meta.env.VITE_SHOPIFY_API_KEY) {
  apiKeyMeta.setAttribute("content", import.meta.env.VITE_SHOPIFY_API_KEY);
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
