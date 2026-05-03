import { Shield, Tags, Sparkles, Send, GraduationCap, type LucideIcon } from "lucide-react";

export type AgentId = "watchdog" | "classifier" | "enrichment" | "publishing" | "learning";

export interface AgentDetail {
  id: AgentId;
  name: string;
  tagline: string;
  icon: LucideIcon;
  accent: string; // tailwind classes for icon chip
  summary: string;
  inputs: string[];
  outputs: string[];
  examples: { title: string; body: string }[];
  triggers: string[];
}

export const AGENT_DETAILS: Record<AgentId, AgentDetail> = {
  watchdog: {
    id: "watchdog",
    name: "Watchdog",
    tagline: "Margin & price guardian",
    icon: Shield,
    accent: "text-amber-500 bg-amber-500/10 border-amber-500/30",
    summary:
      "Watches every price change against your margin rules. Blocks unsafe edits, alerts on competitor moves, and prevents below-cost listings reaching Shopify or Lightspeed.",
    inputs: [
      "Product cost price (from invoice)",
      "Current RRP / sell price",
      "Competitor prices (scraped via Price Intelligence)",
      "Margin rules from Margin Guardian (Strict / Relaxed)",
    ],
    outputs: [
      "Allow / Block decision per variant",
      "Suggested safe price when blocked",
      "Toast + audit log entry",
      "Optional Slack alert when a rule fires",
    ],
    examples: [
      {
        title: "Blocked below-margin price",
        body: "Cost AU$48 · Suggested RRP AU$65 → blocked (target margin 60% requires ≥ AU$120). Watchdog suggests AU$129.",
      },
      {
        title: "Competitor undercut alert",
        body: "Competitor dropped to AU$89 (was AU$119). Watchdog flags 3 SKUs and proposes a matching markdown.",
      },
    ],
    triggers: [
      "Auto-runs after each invoice/packing-slip parse (if enabled)",
      "Runs on every manual price edit",
      "Daily 5:00 AM UTC sweep against latest competitor data",
    ],
  },
  classifier: {
    id: "classifier",
    name: "Classifier",
    tagline: "Auto-tags & categorises",
    icon: Tags,
    accent: "text-teal-400 bg-teal-400/10 border-teal-400/30",
    summary:
      "Reads each product and applies the 7-layer tag formula — category, fabric, season, occasion, fit, audience and collection — so your catalog stays consistently organised.",
    inputs: [
      "Product title and description",
      "Supplier / brand",
      "Source images (when available)",
      "Industry profile (Fashion, Homewares, etc.)",
    ],
    outputs: [
      "Shopify product type + tags",
      "Collection assignment(s)",
      "Lightspeed category mapping",
      "Confidence score per tag",
    ],
    examples: [
      {
        title: "Linen midi dress",
        body: "Tags: Womens, Dresses, Midi, Linen, SS25, Casual, Beach. Collection: Summer 25 → Dresses.",
      },
      {
        title: "Ambiguous title fallback",
        body: '"Style 4421" with no description → Classifier asks Vision AI to read the image, then tags as "Tops > Knit".',
      },
    ],
    triggers: [
      "Auto-runs after parse (if enabled)",
      "Manual: Tools → Classify selection",
      "Bulk: Reports → Tag rules engine",
    ],
  },
  enrichment: {
    id: "enrichment",
    name: "Enrichment",
    tagline: "Names, descriptions & images",
    icon: Sparkles,
    accent: "text-purple-400 bg-purple-400/10 border-purple-400/30",
    summary:
      "Generates SEO-ready titles in the [Color] + [Feature] + [Type] structure, writes product descriptions, and finds the right colour image variants from supplier sites.",
    inputs: [
      "Raw supplier title + SKU",
      "Variant matrix (colour + size)",
      "Supplier website (for image lookup)",
      "Brand voice from Industry Profile",
    ],
    outputs: [
      "Smart product title (≤ 70 chars, GEO-friendly)",
      "Long-form description (HTML, 100–180 words)",
      "Per-colour hero images uploaded to compressed-images bucket",
      "Alt-text + image SEO metadata",
    ],
    examples: [
      {
        title: "Title rewrite",
        body: '"WAL-DR-4421 BLK" → "Black Tiered Linen Midi Dress" (Colour + Feature + Type).',
      },
      {
        title: "Colour images",
        body: "Pulls 3 colourways (Black / Sand / Sage) from walnutmelbourne.com and assigns to matching variants.",
      },
    ],
    triggers: [
      "Auto-runs after parse (if enabled)",
      "Manual: Review screen → ✨ Enrich button",
      "Per-product: Tools → Generate description",
    ],
  },
  publishing: {
    id: "publishing",
    name: "Publishing",
    tagline: "Push to Shopify & Lightspeed",
    icon: Send,
    accent: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    summary:
      "Builds Shopify CSV / Lightspeed exports, syncs inventory, updates barcodes and writes metafields — using idempotent GraphQL calls with a 500ms safety delay between requests.",
    inputs: [
      "Approved products from the Review screen",
      "POS choice (Shopify / Lightspeed) from Phase 1",
      "Location / outlet selection",
      "Margin Guardian clearance",
    ],
    outputs: [
      "Shopify CSV (split into 2,000–5,000 row chunks)",
      "Lightspeed X-Series CSV",
      "Live GraphQL push (productCreate + inventoryAdjust)",
      "Publish status row in audit log",
    ],
    examples: [
      {
        title: "CSV export",
        body: "47 products → 1 Shopify CSV with Colour-first variants, GTIN column, image URLs.",
      },
      {
        title: "Live Shopify push",
        body: "Sequential GraphQL calls (≥500ms apart), batched 8 per metafieldsSet, total 6.2s for 12 products.",
      },
    ],
    triggers: [
      "Manual: Export step in Invoice flow",
      "Auto-runs after parse (off by default — opt in to push automatically)",
    ],
  },
  learning: {
    id: "learning",
    name: "Learning",
    tagline: "Improves from your edits",
    icon: GraduationCap,
    accent: "text-green-400 bg-green-400/10 border-green-400/30",
    summary:
      "Watches every correction you make and feeds it back into the supplier brain — fingerprinting layouts, remembering field positions, and getting better with each invoice.",
    inputs: [
      "User corrections during Review",
      "Accepted vs rejected AI suggestions",
      "Invoice layout fingerprint",
      "Final exported values",
    ],
    outputs: [
      "Updated supplier_intelligence row",
      "Layout fingerprint stored against supplier",
      "Confidence score bump (auto-publish unlocks at ≥90%)",
      "Brand rules added to the global brain",
    ],
    examples: [
      {
        title: "Field position learned",
        body: 'After 3 Walnut invoices, Learning remembers "Wholesale" column = unit cost, no more user prompt.',
      },
      {
        title: "Auto-publish unlocked",
        body: "Witchery hits 92% confidence after 11 invoices → next parse skips manual review.",
      },
    ],
    triggers: [
      "Auto-runs after parse (if enabled)",
      "Runs on every save in Review",
      "Background: aggregate-patterns cron each night",
    ],
  },
};

export const AGENT_ORDER: AgentId[] = ["watchdog", "classifier", "enrichment", "publishing", "learning"];
