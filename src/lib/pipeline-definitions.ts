export interface PipelineStep {
  id: string;
  label: string;
  description: string;
  flow: string;
  autoStart?: boolean;
  skipCondition?: string;
  contextKey?: string;
  /** Emoji icon for step list */
  icon?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  estimatedMinutes: number;
  trigger: "invoice_upload" | "manual" | "scheduled";
  steps: PipelineStep[];
}

export const PIPELINES: Pipeline[] = [
  {
    id: "new_arrivals_full",
    name: "New arrivals — full setup",
    emoji: "📦",
    desc: "Invoice to live product, SEO, collections, and social post",
    estimatedMinutes: 12,
    trigger: "invoice_upload",
    steps: [
      { id: "upload_invoice", label: "Upload invoice", description: "Upload and parse your supplier invoice", flow: "invoice", contextKey: "productList", icon: "📄" },
      { id: "stock_check", label: "Stock check", description: "Check which items are refills, new colours, or new products", flow: "stock_check", contextKey: "stockResult", icon: "🔍" },
      { id: "push_shopify", label: "Push to Shopify", description: "Review and confirm before pushing new products and variants", flow: "shopify_push", icon: "🛒" },
      { id: "image_optimise", label: "Image optimisation", description: "Auto-generate alt text and fix filenames for the products just pushed", flow: "image_optimise", autoStart: true, icon: "🖼" },
      { id: "seo_tags", label: "SEO + tags", description: "Generate SEO titles, meta descriptions, and Shopify tags for new products", flow: "export_review", autoStart: true, icon: "🏷" },
      { id: "feed_health", label: "Feed health", description: "Fix gender, age_group, and colour attributes for Google Shopping", flow: "feed_health", autoStart: true, icon: "📡" },
      { id: "collection_seo", label: "Collection SEO", description: "Generate SEO collection pages for the brands and product types in this invoice", flow: "collection_seo", icon: "📚" },
      { id: "style_grouping", label: "Style grouping", description: "Link colour variants so customers can switch between colours on the product page", flow: "style_grouping", skipCondition: "no_new_variants", icon: "🎨" },
      { id: "social_media", label: "Social media", description: "Generate AI captions and schedule posts for the new arrivals", flow: "social_media", icon: "📱" },
    ],
  },
  {
    id: "restock_only",
    name: "Restock — inventory update",
    emoji: "🔄",
    desc: "Invoice to inventory update — for existing products only",
    estimatedMinutes: 3,
    trigger: "invoice_upload",
    steps: [
      { id: "upload_invoice", label: "Upload invoice", description: "Upload your supplier invoice", flow: "invoice", contextKey: "productList", icon: "📄" },
      { id: "stock_check_refills", label: "Stock check — refills only", description: "Confirm items are existing products before updating stock", flow: "stock_check", icon: "🔍" },
      { id: "update_inventory", label: "Update inventory", description: "Apply inventory adjustments for confirmed refills", flow: "inventory_update", icon: "📦" },
      { id: "accounting_push", label: "Accounting push", description: "Send this invoice to Xero or MYOB as a draft bill", flow: "accounting", skipCondition: "accounting_not_connected", icon: "💰" },
    ],
  },
  {
    id: "seo_visibility",
    name: "SEO & visibility boost",
    emoji: "📈",
    desc: "Run all SEO and discoverability tools in sequence",
    estimatedMinutes: 8,
    trigger: "manual",
    steps: [
      { id: "feed_health", label: "Google Feed Health", description: "Scan and fix gender, age_group, and colour for all products", flow: "feed_health", icon: "📡" },
      { id: "ai_feed", label: "AI Feed Optimisation", description: "Generate product_detail attributes from product images for Google Shopping", flow: "feed_optimise", icon: "🤖" },
      { id: "collection_seo", label: "Collection SEO", description: "Generate SEO descriptions for every collection page that is missing one", flow: "collection_seo", icon: "📚" },
      { id: "organic_seo", label: "Organic SEO", description: "Build a topic map and generate blog posts that rank on Google", flow: "organic_seo", icon: "✍️" },
      { id: "geo_agentic", label: "GEO & Agentic", description: "Optimise for ChatGPT, Perplexity, and Google AI Mode citations", flow: "geo_agentic", icon: "🌐" },
      { id: "collab_seo", label: "Collab SEO", description: "Set up a local partner blog post for backlinks", flow: "collab_seo", icon: "🤝" },
    ],
  },
  {
    id: "marketing_launch",
    name: "Marketing launch",
    emoji: "📣",
    desc: "Ads and social for a new collection or sale",
    estimatedMinutes: 10,
    trigger: "manual",
    steps: [
      { id: "google_colours", label: "Google colours", description: "Detect and fix colour attributes before running ads", flow: "google_colour", icon: "🎨" },
      { id: "google_ads_attrs", label: "Google Ads attributes", description: "Fix age_group and gender to prevent disapprovals", flow: "google_ads", icon: "📊" },
      { id: "social_media", label: "Social media", description: "Generate captions and schedule posts", flow: "social_media", icon: "📱" },
      { id: "google_ads_setup", label: "Google Ads setup", description: "Launch or update your Google Shopping campaign", flow: "google_ads_setup", icon: "🔎" },
      { id: "meta_ads_setup", label: "Meta Ads setup", description: "Launch or update your Facebook + Instagram ads", flow: "meta_ads_setup", icon: "📘" },
      { id: "performance", label: "Performance", description: "Check ROAS and conversion after launch", flow: "performance", icon: "📈" },
    ],
  },
  {
    id: "season_close",
    name: "Season close",
    emoji: "📉",
    desc: "Mark down slow stock, detect dead stock, reorder winners",
    estimatedMinutes: 6,
    trigger: "manual",
    steps: [
      { id: "restock_analytics", label: "Restock analytics", description: "Upload Shopify export. Find size holes and sold-out styles", flow: "restock", icon: "📊" },
      { id: "markdown_ladders", label: "Markdown ladders", description: "Set auto-discount schedules for slow-moving styles from this season", flow: "markdown_ladder", icon: "📉" },
      { id: "margin_protection", label: "Margin protection review", description: "Confirm no markdown goes below cost floor", flow: "margin_protection", icon: "🛡" },
      { id: "reorder_suggestions", label: "Reorder suggestions", description: "See AI recommendations for what to reorder for next season", flow: "reorder", icon: "🔄" },
      { id: "purchase_orders", label: "Purchase orders", description: "Create POs for confirmed reorders", flow: "purchase_orders", icon: "📋" },
      { id: "profit_loss", label: "Profit & Loss", description: "Review true P&L for the season including all expenses", flow: "profit_loss", icon: "💰" },
    ],
  },
];

export function getPipelineById(id: string): Pipeline | undefined {
  return PIPELINES.find((p) => p.id === id);
}