import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ═══ Set Shopify API key meta tag at runtime for App Bridge ═══
const apiKeyMeta = document.getElementById("shopify-api-key-meta");
if (apiKeyMeta && import.meta.env.VITE_SHOPIFY_API_KEY) {
  apiKeyMeta.setAttribute("content", import.meta.env.VITE_SHOPIFY_API_KEY);
}

createRoot(document.getElementById("root")!).render(<App />);
