// ── Sonic Invoices Context Engine ──
// Detects wholesale platform / supplier context from URLs, filenames, and text
// and recommends the most relevant tools/actions.

export type DetectedPlatform =
  | "JOOR" | "Brandscope" | "NuOrder" | "Faire" | "Brandboom"
  | "Google Drive" | "Email" | "PDF Invoice" | "Lookbook"
  | "Other Supplier" | "Unknown";

export interface ContextAction {
  label: string;
  flow: string;
  icon: string;
  description: string;
}

export interface ContextResult {
  platform_detected: DetectedPlatform;
  supplier_name: string | null;
  user_intent: string;
  recommended_actions: ContextAction[];
  highlight_message: string;
  confidence: number;
}

interface PlatformRule {
  platform: DetectedPlatform;
  urlPatterns: RegExp[];
  textPatterns: RegExp[];
  filePatterns: RegExp[];
  intent: string;
  actions: ContextAction[];
  messageTemplate: (supplier?: string) => string;
}

const PLATFORM_RULES: PlatformRule[] = [
  {
    platform: "JOOR",
    urlPatterns: [/joor\.com/i, /jooraccess\.com/i],
    textPatterns: [/joor/i, /virtual\s*showroom/i, /joor\s*collection/i],
    filePatterns: [/joor/i, /linesheet/i],
    intent: "Browsing wholesale collection on JOOR",
    actions: [
      { label: "Pull Products from JOOR", flow: "joor", icon: "🔗", description: "Import this collection directly into Shopify" },
      { label: "Process as Invoice", flow: "invoice", icon: "📄", description: "Extract line items from JOOR order confirmation" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Compare JOOR items with your Shopify inventory" },
      { label: "Lookbook Import", flow: "lookbook_import", icon: "📸", description: "Import product images from JOOR linesheet" },
    ],
    messageTemplate: (s) => s ? `JOOR order from ${s} detected — ready to import?` : "You're on JOOR — want to pull this collection?",
  },
  {
    platform: "Brandscope",
    urlPatterns: [/brandscope\.com/i],
    textPatterns: [/brandscope/i],
    filePatterns: [/brandscope/i],
    intent: "Browsing products on Brandscope",
    actions: [
      { label: "Import from Brandscope", flow: "wholesale_import", icon: "🔗", description: "Pull products from your Brandscope order" },
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Extract items from Brandscope order confirmation" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Check which items you already stock" },
    ],
    messageTemplate: (s) => s ? `Brandscope order from ${s} — import products?` : "Brandscope detected — ready to import?",
  },
  {
    platform: "NuOrder",
    urlPatterns: [/nuorder\.com/i],
    textPatterns: [/nuorder/i],
    filePatterns: [/nuorder/i],
    intent: "Reviewing order on NuOrder",
    actions: [
      { label: "Import from NuOrder", flow: "wholesale_import", icon: "🔗", description: "Pull products from NuOrder order" },
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Extract line items from NuOrder confirmation" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Cross-check with existing inventory" },
    ],
    messageTemplate: (s) => s ? `NuOrder order from ${s} — import?` : "NuOrder detected — import this order?",
  },
  {
    platform: "Faire",
    urlPatterns: [/faire\.com/i],
    textPatterns: [/faire\s*(wholesale)?/i],
    filePatterns: [/faire/i],
    intent: "Shopping on Faire marketplace",
    actions: [
      { label: "Import from Faire", flow: "wholesale_import", icon: "🔗", description: "Pull Faire order into your catalog" },
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Process Faire packing slip or invoice" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Check stock levels for Faire products" },
    ],
    messageTemplate: (s) => s ? `Faire order from ${s} detected` : "Faire detected — want to import?",
  },
  {
    platform: "Brandboom",
    urlPatterns: [/brandboom\.com/i],
    textPatterns: [/brandboom/i],
    filePatterns: [/brandboom/i],
    intent: "Browsing Brandboom linesheet",
    actions: [
      { label: "Import from Brandboom", flow: "wholesale_import", icon: "🔗", description: "Import Brandboom linesheet products" },
      { label: "Lookbook Import", flow: "lookbook_import", icon: "📸", description: "Extract images from Brandboom" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Check existing stock" },
    ],
    messageTemplate: (s) => s ? `Brandboom linesheet from ${s}` : "Brandboom detected — import products?",
  },
  {
    platform: "Google Drive",
    urlPatterns: [/drive\.google\.com/i, /docs\.google\.com/i],
    textPatterns: [],
    filePatterns: [],
    intent: "Accessing files on Google Drive",
    actions: [
      { label: "Import from Drive", flow: "gdrive_import", icon: "📁", description: "Fetch invoices or linesheets from this Drive folder" },
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Download and process as invoice" },
      { label: "Train Supplier Profile", flow: "supplier_profile", icon: "🧠", description: "Use Drive files to train a supplier profile" },
    ],
    messageTemplate: () => "Google Drive link — import files for processing?",
  },
  {
    platform: "Email",
    urlPatterns: [/mail\.google\.com/i, /outlook\.(live|office)\.com/i, /webmail/i],
    textPatterns: [/invoice\s*(attached|enclosed)/i, /order\s*confirmation/i, /packing\s*slip/i, /dispatch\s*notice/i, /shipment\s*notification/i],
    filePatterns: [],
    intent: "Viewing supplier email with invoice or order",
    actions: [
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Extract items from the attached invoice" },
      { label: "Forward to Sonic", flow: "email_forward", icon: "📧", description: "Forward this email for automatic processing" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Check stock for items in this email" },
    ],
    messageTemplate: (s) => s ? `Invoice email from ${s} — process it?` : "Supplier email detected — extract the invoice?",
  },
  {
    platform: "PDF Invoice",
    urlPatterns: [],
    textPatterns: [/tax\s*invoice/i, /invoice\s*number/i, /ABN\s*\d/i, /purchase\s*order/i, /bill\s*to/i, /ship\s*to/i],
    filePatterns: [/\.pdf$/i, /invoice/i, /po[\s_-]?\d/i, /packing/i],
    intent: "Viewing a supplier invoice or packing slip",
    actions: [
      { label: "Process Invoice", flow: "invoice", icon: "📄", description: "AI-extract all line items from this document" },
      { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Compare invoice items with Shopify stock" },
      { label: "Push to Accounting", flow: "accounting", icon: "💰", description: "Send invoice to Xero/MYOB" },
      { label: "Train Supplier Profile", flow: "supplier_profile", icon: "🧠", description: "Learn this supplier's invoice format" },
    ],
    messageTemplate: (s) => s ? `Invoice from ${s} — ready to extract?` : "Invoice detected — process with AI?",
  },
  {
    platform: "Lookbook",
    urlPatterns: [],
    textPatterns: [/lookbook/i, /collection\s*(preview|launch|ss|aw|fw|resort)/i, /new\s*arrivals/i, /pre[\s-]?order/i],
    filePatterns: [/lookbook/i, /collection/i, /linesheet/i, /catalogue/i, /catalog/i],
    intent: "Viewing a supplier lookbook or collection",
    actions: [
      { label: "Lookbook Import", flow: "lookbook_import", icon: "📸", description: "Extract product images and details" },
      { label: "Process as Invoice", flow: "invoice", icon: "📄", description: "Extract pricing from lookbook/linesheet" },
      { label: "Collection Builder", flow: "collection_builder", icon: "🏷️", description: "Create Shopify collection from this lookbook" },
    ],
    messageTemplate: (s) => s ? `Lookbook from ${s} — import products?` : "Lookbook detected — extract products?",
  },
];

// ── Supplier name extraction ──

const KNOWN_BRANDS = [
  "Zimmermann", "Aje", "Camilla", "Scanlan Theodore", "Rebecca Vallance",
  "Sir The Label", "Bec & Bridge", "Shona Joy", "Acler", "Ksubi",
  "Spell", "Tigerlily", "Faithfull The Brand", "Hansen & Gretel",
  "Steele", "Elka Collective", "St Agni", "Matteau", "Bassike",
  "Lee Mathews", "Cecilie Bahnsen", "Ganni", "Stine Goya", "Rixo",
  "Rotate Birger Christensen", "Nanushka", "Cult Gaia", "Jacquemus",
];

function extractSupplierName(url: string, text: string, fileName: string): string | null {
  // Check URL for brand subdomain
  const urlMatch = url.match(/(?:https?:\/\/)?([\w-]+)\.(com|com\.au|co)/);
  if (urlMatch) {
    const domain = urlMatch[1].toLowerCase();
    const brand = KNOWN_BRANDS.find(b => domain.includes(b.toLowerCase().replace(/\s+/g, "")));
    if (brand) return brand;
  }

  // Check text for known brands
  const combined = `${text} ${fileName}`.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (combined.includes(brand.toLowerCase())) return brand;
  }

  // Try to extract from filename patterns like "SUPPLIER_invoice_123.pdf"
  const fileMatch = fileName.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
  if (fileMatch && fileMatch[1].length > 2) return fileMatch[1];

  return null;
}

// ── Main detection function ──

export function detectContext(input: {
  url?: string;
  text?: string;
  fileName?: string;
}): ContextResult {
  const url = input.url || "";
  const text = input.text || "";
  const fileName = input.fileName || "";

  let bestMatch: PlatformRule | null = null;
  let bestScore = 0;

  for (const rule of PLATFORM_RULES) {
    let score = 0;

    // URL match (highest weight)
    if (url && rule.urlPatterns.some(p => p.test(url))) score += 50;

    // Text match
    if (text && rule.textPatterns.some(p => p.test(text))) score += 30;

    // Filename match
    if (fileName && rule.filePatterns.some(p => p.test(fileName))) score += 20;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  if (!bestMatch || bestScore === 0) {
    // Check for generic supplier signals
    const supplierSignals = /wholesale|pricelist|order\s*form|trade\s*price|cost\s*price|rrp/i;
    if (supplierSignals.test(text) || supplierSignals.test(fileName)) {
      const supplier = extractSupplierName(url, text, fileName);
      return {
        platform_detected: "Other Supplier",
        supplier_name: supplier,
        user_intent: "Browsing a supplier or wholesale site",
        recommended_actions: [
          { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Extract line items with AI" },
          { label: "Stock Check", flow: "stock_check", icon: "🔍", description: "Compare with Shopify inventory" },
          { label: "Lookbook Import", flow: "lookbook_import", icon: "📸", description: "Import product images" },
        ],
        highlight_message: supplier ? `Supplier ${supplier} detected — what would you like to do?` : "Supplier content detected — process it?",
        confidence: 45,
      };
    }

    return {
      platform_detected: "Unknown",
      supplier_name: null,
      user_intent: "Unknown context",
      recommended_actions: [
        { label: "Process Invoice", flow: "invoice", icon: "📄", description: "Upload and extract any invoice" },
        { label: "Quick Capture", flow: "quick_capture", icon: "📷", description: "Snap a photo of a document" },
      ],
      highlight_message: "Paste a URL or upload a file to get started",
      confidence: 0,
    };
  }

  const supplier = extractSupplierName(url, text, fileName);
  const confidence = Math.min(98, bestScore + (supplier ? 15 : 0));

  return {
    platform_detected: bestMatch.platform,
    supplier_name: supplier,
    user_intent: bestMatch.intent,
    recommended_actions: bestMatch.actions,
    highlight_message: bestMatch.messageTemplate(supplier || undefined),
    confidence,
  };
}

/**
 * Detect context from a pasted URL string
 */
export function detectFromUrl(url: string): ContextResult {
  return detectContext({ url });
}

/**
 * Detect context from an uploaded file
 */
export function detectFromFile(fileName: string, textPreview?: string): ContextResult {
  return detectContext({ fileName, text: textPreview });
}

/**
 * Detect context from pasted text (email body, etc.)
 */
export function detectFromText(text: string): ContextResult {
  return detectContext({ text });
}
