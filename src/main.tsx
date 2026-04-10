import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ═══ Set Shopify API key meta tag at runtime for App Bridge ═══
const apiKeyMeta = document.getElementById("shopify-api-key-meta");
if (apiKeyMeta && import.meta.env.VITE_SHOPIFY_API_KEY) {
  apiKeyMeta.setAttribute("content", import.meta.env.VITE_SHOPIFY_API_KEY);
}

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
