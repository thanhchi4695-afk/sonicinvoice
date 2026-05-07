import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "https://xuaakgdkkrrsqxafffyj.supabase.co";
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54";

// Shopify API key — public client ID, safe to bundle. Already present in
// index.html meta tag; also exposed here so main.tsx can initialise App Bridge.
const shopifyApiKey =
  process.env.VITE_SHOPIFY_API_KEY ?? "aebbc68f4f67197beb20489d6d2987e4";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabasePublishableKey),
    "import.meta.env.VITE_SHOPIFY_API_KEY": JSON.stringify(shopifyApiKey),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "react-i18next", "i18next"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-tabs", "@radix-ui/react-select"],
        },
      },
    },
  },
}));
