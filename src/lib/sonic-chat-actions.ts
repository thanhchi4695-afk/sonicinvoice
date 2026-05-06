// Sonic chat action executor — Sprint 3.
// Maps the structured `action` returned by the intent classifier to real app side-effects.
// Only safe (requires_permission: false) actions run automatically here.

import { generateTags, type TagInput, TYPE_OPTIONS } from "@/lib/tag-engine";
import { getBrandDirectory } from "@/lib/brand-directory";
import { generateSeo, type SeoProduct } from "@/lib/seo-engine";
import { getStoreConfig } from "@/lib/prompt-builder";
import { supabase } from "@/integrations/supabase/client";
import {
  applyTagsAndSeo,
  buildShopifyCsv,
  csvDownloadUrl,
  type ParsedRow,
} from "@/lib/parse-from-chat";

export type StatusEmitter = (line: string) => void | Promise<void>;

export interface ParseFromChatResult {
  csvUrl: string;
  rowCount: number;
  brand: string;
}

/**
 * Sequential pipeline executed when the user confirms `parse_from_chat`.
 * Calls the parse-chat-invoice edge function, then enriches + builds CSV locally,
 * emitting a status line after each step via `onStatus`.
 */
export async function runParseFromChat(
  invoiceText: string,
  supplierHint: string | undefined,
  onStatus: StatusEmitter,
): Promise<ParseFromChatResult> {
  const brand = (supplierHint || "Unknown Brand").trim();

  const { data, error } = await supabase.functions.invoke("parse-chat-invoice", {
    body: { text: invoiceText, supplier: brand },
  });
  if (error) throw new Error(error.message ?? "Parse failed");
  if (data?.error) throw new Error(data.error);
  const rows: ParsedRow[] = Array.isArray(data?.rows) ? data.rows : [];
  await onStatus(`✓ Extracted ${rows.length} product line${rows.length === 1 ? "" : "s"}`);
  if (rows.length === 0) throw new Error("No product lines found in that text.");

  await onStatus(`✓ Applied ${brand} rules`);

  const enriched = applyTagsAndSeo(rows, brand);
  await onStatus(`✓ Tags generated (${enriched.reduce((n, r) => n + r.tags.length, 0)} total)`);
  await onStatus(`✓ SEO titles written for ${enriched.length} products`);

  const csv = buildShopifyCsv(enriched);
  const csvUrl = csvDownloadUrl(csv);
  await onStatus("✓ Shopify CSV prepared");

  return { csvUrl, rowCount: enriched.length, brand };
}

export type SonicAction =
  | "navigate_tab"
  | "open_case_study"
  | "open_brand_guide"
  | "open_file_picker"
  | "show_last_invoice"
  | "show_brand_accuracy"
  | "show_flywheel_summary"
  | "list_trained_brands"
  | "open_correction_ui"
  | "scan_email_inbox"
  | "explain"
  | "none"
  | string;

export interface SonicDecision {
  intent?: string;
  action?: SonicAction;
  params?: Record<string, unknown>;
  requires_permission?: boolean;
  confirmation_message?: string | null;
  response_text?: string;
}

// Valid top-level tabs in Index.tsx
const VALID_TABS = new Set([
  "home",
  "invoices",
  "tools",
  "history",
  "flywheel",
  "analytics",
  "billing",
  "help",
  "howto",
  "account",
  "ai_agents",
  "google_ads",
]);

// Aliases the AI may emit → real tab keys
const TAB_ALIASES: Record<string, string> = {
  settings: "account",
  products: "tools",
  marketing: "tools",
};

function navigateTab(tab: string) {
  const target = TAB_ALIASES[tab] ?? tab;
  window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: target }));
}

function navigateFlow(flow: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new CustomEvent("sonic:navigate-flow", { detail: params ? { id: flow, params } : flow }),
  );
}

// Map of action_key → { tab?, flow? } using REAL Index.tsx FLOW_KEYS / tab names.
// `flow` takes priority and renders the screen; `tab` is the fallback when no flow matches.
const ACTION_MAP: Record<string, { tab?: string; flow?: string }> = {
  // Invoices tab
  open_invoice_upload: { tab: "invoices", flow: "invoice" },
  open_packing_slip: { tab: "invoices", flow: "packing_slip" },
  open_scan_mode: { tab: "invoices", flow: "scan_mode" },
  open_email_inbox: { tab: "invoices", flow: "email_inbox" },
  open_joor: { tab: "invoices", flow: "joor" },
  open_wholesale_import: { tab: "invoices", flow: "wholesale_import" },
  open_lookbook_import: { tab: "invoices", flow: "lookbook_import" },
  open_purchase_orders: { tab: "invoices", flow: "purchase_orders" },
  open_order_forms: { tab: "invoices", flow: "order_form" },
  open_accounting_push: { tab: "invoices", flow: "accounting" },
  open_stock_check: { tab: "invoices", flow: "stock_check" },

  // Products / inventory
  open_inventory_hub: { tab: "tools", flow: "inventory_view" },
  open_stock_monitor: { tab: "tools", flow: "stock_monitor" },
  open_restock_analytics: { tab: "tools", flow: "restock" },
  open_reorder: { tab: "tools", flow: "reorder" },
  open_inventory_planning: { tab: "tools", flow: "inventory_planning" },
  open_price_adjustment: { tab: "tools", flow: "price_adjust" },
  open_price_lookup: { tab: "tools", flow: "price_lookup" },
  open_margin_protection: { tab: "tools", flow: "margin_protection" },
  open_markdown_ladders: { tab: "tools", flow: "markdown_ladder" },
  open_pl_analysis: { tab: "tools", flow: "profit_loss" },
  open_bulk_sale: { tab: "tools", flow: "sale" },
  open_product_health: { tab: "tools", flow: "product_health" },
  open_style_grouping: { tab: "tools", flow: "style_grouping" },
  open_seasons: { tab: "tools", flow: "seasons" },
  open_image_optimisation: { tab: "tools", flow: "image_optimise" },
  open_catalog_memory: { tab: "tools", flow: "catalog_memory" },
  open_supplier_performance: { tab: "tools", flow: "supplier_intelligence" },
  open_suppliers: { tab: "tools", flow: "suppliers" },
  open_lightspeed_converter: { tab: "tools", flow: "lightspeed_convert" },
  open_order_sync: { tab: "tools", flow: "order_sync" },

  // Marketing
  open_feed_health: { tab: "tools", flow: "feed_health" },
  open_feed_optimisation: { tab: "tools", flow: "feed_optimise" },
  open_google_colours: { tab: "tools", flow: "google_colour" },
  open_google_ads_attributes: { tab: "google_ads" },
  open_google_ads_setup: { tab: "tools", flow: "google_ads_setup" },
  open_meta_ads_setup: { tab: "tools", flow: "meta_ads_setup" },
  open_performance_dashboard: { tab: "tools", flow: "performance" },
  open_competitor_intel: { tab: "tools", flow: "competitor_intel" },
  open_organic_seo: { tab: "tools", flow: "organic_seo" },
  open_collection_seo: { tab: "tools", flow: "collection_seo" },
  open_geo_agentic: { tab: "tools", flow: "geo_agentic" },
  open_collab_seo: { tab: "tools", flow: "collab_seo" },
  open_social_media: { tab: "tools", flow: "social_media" },

  // Tools
  // open_tag_builder + open_seo_writer are handled inline (see runInlineAction)
  open_export_collections: { tab: "tools" },
  open_import_collections: { tab: "tools" },
  open_auto_collections: { tab: "tools", flow: "collection_decomposer" },
  open_collection_seo_ai: { tab: "tools", flow: "collection_seo" },
  open_image_downloader: { tab: "tools" },
  open_google_feed_preview: { tab: "tools", flow: "feed_health" },
  open_ai_instructions: { tab: "account" },
  open_learning_memory: { tab: "tools", flow: "supplier_intelligence" },
  open_supplier_email_templates: { tab: "tools" },
  open_audit_log: { tab: "tools", flow: "audit_log" },
};

/**
 * Execute an action returned by the Sonic intent classifier.
 * Returns true if a side-effect was performed, false otherwise (e.g. explain/none).
 */
export function executeChatAction(decision: SonicDecision): boolean {
  if (!decision || !decision.action) return false;
  if (decision.requires_permission) return false; // gated — handled by permission UI in Sprint 4
  const action = decision.action;
  const params = decision.params ?? {};

  // Generic mapped actions (open_* across all tabs)
  if (ACTION_MAP[action]) {
    const { tab, flow } = ACTION_MAP[action];
    // Always set the tab first so the flow renders inside the right shell
    // (and the previous flow is cleared by the navigate-tab handler).
    if (tab) navigateTab(tab);
    if (flow) {
      // Defer the flow dispatch so the tab change settles first.
      setTimeout(() => navigateFlow(flow, params), 0);
    }
    return true;
  }

  switch (action) {
    case "navigate_tab": {
      const tab = String(params.tab ?? "").toLowerCase();
      const target = TAB_ALIASES[tab] ?? tab;
      if (VALID_TABS.has(target)) {
        navigateTab(target);
        return true;
      }
      return false;
    }
    case "open_case_study":
      window.location.assign("/case-study");
      return true;
    case "open_brand_guide":
      window.location.assign("/brand-guide");
      return true;
    case "open_file_picker": {
      // legacy Sprint-3 alias
      const mode = String(params.mode ?? "pdf").toLowerCase();
      navigateTab("invoices");
      navigateFlow(mode === "email" ? "email_inbox" : "invoice");
      return true;
    }
    case "show_last_invoice":
      navigateTab("history");
      return true;
    case "show_brand_accuracy": {
      const brand = String(params.brand_name ?? "").trim();
      navigateTab("flywheel");
      if (brand) {
        window.dispatchEvent(
          new CustomEvent("sonic:flywheel-filter", { detail: { brand_name: brand } }),
        );
      }
      return true;
    }
    case "show_flywheel_summary":
    case "list_trained_brands":
      navigateTab("flywheel");
      return true;
    case "open_correction_ui":
      navigateTab("history");
      return true;
    case "scan_email_inbox":
      navigateTab("invoices");
      navigateFlow("email_inbox");
      return true;
    case "explain":
    case "none":
    default:
      // explain → render response_text inline; no side-effect
      return false;
  }
}

/**
 * Execute a permission-gated action AFTER the user has confirmed.
 * These dispatch events that the rest of the app can listen for, so the
 * heavy logic stays in its existing modules.
 */
export function executeGatedAction(decision: SonicDecision): boolean {
  if (!decision || !decision.action) return false;
  const params = decision.params ?? {};

  switch (decision.action) {
    case "export_csv": {
      const invoiceId = String(params.invoice_id ?? "last");
      window.dispatchEvent(
        new CustomEvent("sonic:export-csv", { detail: { invoice_id: invoiceId } }),
      );
      return true;
    }
    case "delete_brand_patterns": {
      const brand = String(params.brand_name ?? "").trim();
      if (!brand) return false;
      window.dispatchEvent(
        new CustomEvent("sonic:delete-brand-patterns", { detail: { brand_name: brand } }),
      );
      return true;
    }
    case "parse_pending_emails": {
      window.dispatchEvent(
        new CustomEvent("sonic:parse-pending-emails", {
          detail: { invoice_ids: params.invoice_ids ?? "all" },
        }),
      );
      return true;
    }
    case "export_batch_csv": {
      const period = String(params.period ?? "this_month");
      window.dispatchEvent(
        new CustomEvent("sonic:export-batch-csv", { detail: { period } }),
      );
      return true;
    }
    case "open_accounting_push": {
      const platform = String(params.platform ?? "any");
      window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: "invoices" }));
      window.dispatchEvent(
        new CustomEvent("sonic:navigate-flow", {
          detail: { id: "accounting_push", params: { platform } },
        }),
      );
      return true;
    }
    case "open_bulk_sale": {
      window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: "products" }));
      window.dispatchEvent(
        new CustomEvent("sonic:navigate-flow", { detail: { id: "bulk_sale", params } }),
      );
      return true;
    }
    default:
      return false;
  }
}

// ── Inline action handlers ─────────────────────────────────────────────────
// These return a string to render as the next assistant chat message instead
// of navigating anywhere. Returns null when the action is not inline.

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Try to extract a cost price from a free-form user message ("cost is $42.50",
// "for $30", "30 dollars"). Returns NaN when nothing usable is found.
function extractCost(text: string): number {
  const m = text.match(/\$?\s*(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (!m) return NaN;
  return Number(m[1].replace(",", "."));
}

export interface InlineActionResult {
  text: string;
  copyable?: string;
  seo?: {
    title: string;
    description: string;
    titleLen: number;
    descLen: number;
    titleOver: boolean;
    descOver: boolean;
  };
  margin?: {
    cost: number;
    brand: string | null;
    category: string;
    categoryInferred: boolean;
    multiplier: number;
    rrp: number;
    rrpExGst: number;
    grossProfit: number;
    marginPct: number;
    compareAt: number;
  };
  email?: {
    supplierName: string;
    emailType: string;
    subject: string;
    body: string;
    productDetails: string;
    userName: string;
    storeName: string;
    toneVariant: number;
  };
  description?: {
    brandName: string;
    productName: string;
    colour: string;
    productType: string;
    features: string[];
    text: string;
    lengthVariant: "default" | "shorter" | "longer";
  };
  quickReplies?: string[];
}

const KNOWN_COLOURS = [
  "black","white","ivory","cream","beige","tan","brown","chocolate","khaki","olive","mustard",
  "yellow","gold","orange","coral","peach","red","crimson","burgundy","wine","pink","blush",
  "rose","fuchsia","magenta","purple","lilac","lavender","plum","navy","blue","cobalt","denim",
  "sky","teal","turquoise","aqua","mint","sage","green","emerald","forest","silver","grey","gray",
  "charcoal","leopard","animal","floral","stripe","striped","print","multi",
];

function detectColour(text: string): string | null {
  const lower = text.toLowerCase();
  const sorted = [...KNOWN_COLOURS].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    const re = new RegExp(`\\b${c}\\b`, "i");
    if (re.test(lower)) return c.replace(/\b\w/g, (x) => x.toUpperCase());
  }
  return null;
}

function detectProductName(
  text: string,
  brand: string | null,
  colour: string | null,
  productType: string | null,
): string | null {
  // Quoted phrase wins
  const q = text.match(/["“']([^"”']{2,60})["”']/);
  if (q) return q[1].trim();
  // Strip known tokens, return remaining capitalised words sequence
  let cleaned = text;
  for (const tok of [brand, colour, productType]) {
    if (tok) cleaned = cleaned.replace(new RegExp(tok, "ig"), " ");
  }
  cleaned = cleaned.replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
  // Look for 1-4 capitalised tokens (style codes like "Mar26" allowed)
  const m = cleaned.match(/\b([A-Z][\w-]+(?:\s+[A-Z][\w-]+){0,3})\b/);
  return m ? m[1].trim() : null;
}

// Builds the SEO title using the required pattern:
// "[Brand] [StyleName] - [Colour] | Australia"
// Truncated to 62 chars + "..." when over 65 chars total.
function buildSEO(brand: string, styleName: string, colour: string) {
  const parts: string[] = [];
  if (brand) parts.push(brand);
  if (styleName) parts.push(styleName);
  let left = parts.join(" ").trim();
  if (colour) left = `${left} - ${colour}`.trim();
  let title = `${left} | Australia`.replace(/\s+/g, " ").trim();
  if (title.length > 65) title = title.slice(0, 62).trimEnd() + "...";
  return title;
}

// Match a known product type in free-form text. Returns the canonical option.
function detectProductType(text: string): string | null {
  const lower = text.toLowerCase();
  // Sort by length so "bikini tops" wins over "tops"
  const sorted = [...TYPE_OPTIONS].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (lower.includes(t.toLowerCase())) return t;
  }
  // Common singular/loose aliases
  const aliases: Record<string, string> = {
    "bikini top": "Bikini Tops",
    "bikini bottom": "Bikini Bottoms",
    "one piece": "One Pieces",
    "swim dress": "Swimdress",
    "rashie": "Rashies & Sunsuits",
    "tankini": "Tankini Tops",
    "boardshort": "Boardshorts",
    "sunglass": "Sunnies",
  };
  for (const [k, v] of Object.entries(aliases)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

function detectBrand(text: string): string | null {
  try {
    const dir = getBrandDirectory();
    const lower = text.toLowerCase();
    const sorted = [...dir].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
    for (const b of sorted) {
      if (b.name && lower.includes(b.name.toLowerCase())) return b.name;
    }
  } catch {}
  // Common fallbacks
  const known = ["Seafolly", "Funkita", "Funky Trunks", "Jantzen", "Sea Level", "Speedo", "Baku", "Pops + Co", "Le Specs"];
  const lower = text.toLowerCase();
  for (const k of known.sort((a, b) => b.length - a.length)) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

function detectArrivalMonth(text: string): string | null {
  const m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\b/i);
  if (!m) return null;
  return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + m[2];
}

function currentArrivalMonth(): string {
  const d = new Date();
  const mon = d.toLocaleString("en-US", { month: "short" });
  const yy = String(d.getFullYear()).slice(-2);
  return `${mon}${yy}`;
}

function detectSpecials(text: string): string[] {
  const lower = text.toLowerCase();
  const specials: string[] = [];
  if (/\b(dd|d\/e|e\/f|f\/g|g\/h|fuller cup|d-g|d-dd|a-dd)\b/.test(lower)) specials.push("d-g");
  if (lower.includes("underwire")) specials.push("underwire");
  if (lower.includes("chlorine")) specials.push("chlorine resist");
  if (lower.includes("plus size") || /\b18\+\b/.test(lower) || lower.includes("extended")) specials.push("plus size");
  if (lower.includes("tummy")) specials.push("tummy control");
  if (lower.includes("mastectomy")) specials.push("mastectomy");
  return [...new Set(specials)];
}

function buildTagsFromMessage(
  params: Record<string, unknown>,
  userMessage: string,
): { vendor: string; productType: string; tags: string[] } {
  const vendor =
    String(params.brand ?? params.brand_name ?? params.vendor ?? "").trim() ||
    detectBrand(userMessage) ||
    "Unknown Brand";

  let productType =
    String(params.product_type ?? params.type ?? "").trim() ||
    detectProductType(userMessage) ||
    "Bikini Tops";
  // Special swimdress override
  if (/\bswim ?dress\b/i.test(userMessage)) productType = "Swimdress";

  const lower = userMessage.toLowerCase();
  const isNew = /\bnew\b/.test(lower) || params.isNew === true;
  const hasCompareAt =
    /\b(on sale|sale price|compare at|compare-at)\b/.test(lower) || params.hasCompareAt === true;
  const arrivalMonth =
    String(params.arrival_month ?? params.arrivalMonth ?? "").trim() ||
    detectArrivalMonth(userMessage) ||
    currentArrivalMonth();

  const specials = detectSpecials(userMessage);

  const input: TagInput = {
    title: `${vendor} ${productType}`,
    brand: vendor,
    productType,
    arrivalMonth,
    priceStatus: hasCompareAt ? "sale" : "full_price",
    isNew,
    specials,
  };
  return { vendor, productType, tags: generateTags(input) };
}

export async function runInlineAction(
  decision: SonicDecision,
  userMessage: string,
): Promise<InlineActionResult | null> {
  if (!decision || !decision.action) return null;
  const params = decision.params ?? {};

  if (decision.action === "open_stock_check") {
    // Explicit "show full stock check" → fall through to navigation.
    if (/\b(see all stock|show full stock check|open stock check|full stock check)\b/i.test(userMessage)) {
      return null;
    }

    const brand =
      String(params.brand_name ?? params.brand ?? params.supplier ?? "").trim() ||
      detectBrand(userMessage) ||
      "";
    const skuRaw =
      String(params.sku ?? params.style_number ?? params.style ?? "").trim() ||
      (userMessage.match(/\b([A-Z0-9]{4,}[-_]?\d{2,}|\d{5,})\b/)?.[1] ?? "");

    if (!brand && !skuRaw) {
      // Nothing usable inline — let the screen open instead.
      return null;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { text: "Sign in to check your stock history." };
      }

      // Brand existence in brand_patterns
      let brandKnown = false;
      if (brand) {
        const { data: bp } = await supabase
          .from("brand_patterns")
          .select("brand_name")
          .eq("user_id", user.id)
          .ilike("brand_name", brand)
          .limit(1);
        brandKnown = !!(bp && bp.length > 0);
      }

      // Import history rows for this brand
      let rows: Array<{ style_number: string | null; colour: string | null; started_at: string | null }> = [];
      if (brand) {
        const { data: hist } = await supabase
          .from("inventory_import_runs")
          .select("style_number, colour, started_at")
          .eq("user_id", user.id)
          .ilike("supplier_name", brand)
          .order("started_at", { ascending: false })
          .limit(200);
        rows = (hist ?? []) as typeof rows;
      }

      const styleNorm = skuRaw.toLowerCase().replace(/[-_\s]/g, "");
      const sameStyleRows = styleNorm
        ? rows.filter(
            (r) => (r.style_number ?? "").toLowerCase().replace(/[-_\s]/g, "") === styleNorm,
          )
        : [];

      const refillMatch = sameStyleRows[0];
      const tagLineNew = "add `new` + `new arrivals` + department new tag";
      const tagLineRefill = "no `new` / `new arrivals` tags needed";

      let classification: "REFILL" | "NEW COLOUR" | "NEW PRODUCT";
      let detail: string;

      if (skuRaw && refillMatch) {
        classification = "REFILL";
        const date = refillMatch.started_at
          ? new Date(refillMatch.started_at).toLocaleDateString()
          : "previously";
        const colours = [
          ...new Set(sameStyleRows.map((r) => r.colour).filter(Boolean) as string[]),
        ];
        // NEW COLOUR check: same style exists but the user's colour isn't among them
        const userColour = detectColour(userMessage);
        if (userColour && colours.length > 0 && !colours.some((c) => c.toLowerCase() === userColour.toLowerCase())) {
          classification = "NEW COLOUR";
          detail = `You stock this ${brand || "style"} in ${colours.join(", ")}. This looks like a NEW COLOUR.`;
        } else {
          detail = `That style (${brand ? brand + " " : ""}${skuRaw}) is already in your catalog — last imported ${date}. This is a REFILL.`;
        }
      } else if (brand && brandKnown) {
        classification = "NEW PRODUCT";
        detail = skuRaw
          ? `${brand} is a known brand but style ${skuRaw} isn't in your history. Treat as a NEW PRODUCT.`
          : `${brand} is a known brand but no matching style was provided. Treat as a NEW PRODUCT.`;
      } else if (brand) {
        classification = "NEW PRODUCT";
        detail = `${brand} isn't in your history yet. This is a NEW PRODUCT — first invoice from this brand.`;
      } else {
        return null;
      }

      const tagAdvice = classification === "REFILL" ? tagLineRefill : tagLineNew;
      const text = [
        `**${classification}**`,
        "",
        detail,
        "",
        `**Tags:** ${tagAdvice}`,
      ].join("\n");
      return { text };
    } catch (e) {
      console.error("stock check inline failed:", e);
      return null;
    }
  }

  if (decision.action === "calculate_margin") {
    const cost = Number.isFinite(Number(params.cost))
      ? Number(params.cost)
      : extractCost(userMessage);
    const brand =
      String(params.brand ?? "").trim() || detectBrand(userMessage) || undefined;
    const category = String(params.category ?? "").trim().toLowerCase() || undefined;
    const productType =
      String(params.product_type ?? params.type ?? "").trim() ||
      detectProductType(userMessage) ||
      undefined;

    if (!Number.isFinite(cost) || cost <= 0) {
      return { text: "Give me a cost price and I'll work out the RRP — e.g. 'cost is $42.50 Baku'." };
    }

    try {
      const { data, error } = await supabase.functions.invoke("calculate-margin", {
        body: { cost, brand, category, product_type: productType },
      });
      if (error) throw error;
      if (!data || data.error) {
        return { text: `Couldn't calculate margin: ${data?.error ?? "unknown error"}` };
      }

      const text = [
        `**$${data.cost.toFixed(2)} cost${data.brand ? " " + titleCase(data.brand) : ""}** → **$${data.rrp.toFixed(2)} RRP**`,
      ].join("\n");

      return {
        text,
        margin: {
          cost: data.cost,
          brand: data.brand ?? null,
          category: data.category,
          categoryInferred: !!data.category_inferred,
          multiplier: data.multiplier,
          rrp: data.rrp,
          rrpExGst: data.rrp_ex_gst,
          grossProfit: data.gross_profit,
          marginPct: data.margin_pct,
          compareAt: data.compare_at,
        },
      };
    } catch (e) {
      console.error("calculate-margin failed:", e);
      return { text: "Couldn't reach the margin calculator — try again in a moment." };
    }
  }

  if (decision.action === "open_tag_builder" || decision.action === "generate_tags_inline") {
    try {
      const { vendor, productType, tags } = buildTagsFromMessage(params, userMessage);
      const csv = tags.join(", ");
      return {
        text: [
          `**Tags for ${vendor} ${productType}**`,
          "",
          "```",
          csv,
          "```",
        ].join("\n"),
        copyable: csv,
      };
    } catch (e) {
      console.error("tag generation failed:", e);
      return {
        text: "Couldn't generate tags — try again with a brand and product type (e.g. 'tags for Seafolly Bikini Tops').",
      };
    }
  }

  if (decision.action === "open_seo_writer") {
    const brand =
      String(params.brand ?? params.brand_name ?? "").trim() ||
      detectBrand(userMessage) ||
      "";
    const productType =
      String(params.product_type ?? params.type ?? "").trim() ||
      detectProductType(userMessage) ||
      "";
    const colour =
      String(params.colour ?? params.color ?? "").trim() ||
      detectColour(userMessage) ||
      "";
    const productName =
      String(params.product_name ?? params.style ?? params.title ?? "").trim() ||
      detectProductName(userMessage, brand, colour, productType) ||
      "";

    // Need at least brand + product name. Brand-only → ask follow-up.
    if (brand && !productName) {
      return { text: "What's the style name and colour?" };
    }
    if (!brand && !productName) {
      return {
        text: "Give me a brand and product name to write SEO for — e.g. 'SEO for Seafolly Mar26 in Black'.",
      };
    }

    const title = buildSEO(brand, productName, colour);

    let description = "";
    try {
      const { data, error } = await supabase.functions.invoke("sonic-seo-writer", {
        body: {
          brand,
          product_name: productName,
          colour,
          product_type: productType,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      description = String(data?.description ?? "").trim();
    } catch (e) {
      console.error("sonic-seo-writer failed:", e);
      return { text: "Couldn't reach the SEO writer — try again in a moment." };
    }

    const titleLen = title.length;
    const descLen = description.length;
    const titleOver = titleLen > 65;
    const descOver = descLen > 155;
    const titleBadge = `${titleLen}/65`;
    const descBadge = `${descLen}/155`;

    const text = [
      `**SEO Title** — ${titleOver ? "🔴" : "🟢"} ${titleBadge}`,
      title,
      "",
      `**Meta Description** — ${descOver ? "🔴" : "🟢"} ${descBadge}`,
      description,
    ].join("\n");

    return {
      text,
      seo: { title, description, titleLen, descLen, titleOver, descOver },
    };
  }
  if (decision.action === "write_supplier_email") {
    const supplierName =
      String(params.supplier_name ?? params.supplier ?? params.brand ?? "").trim() ||
      detectBrand(userMessage) ||
      "";

    if (!supplierName) {
      return { text: "Which supplier?" };
    }

    const lower = userMessage.toLowerCase();
    let emailType = String(params.email_type ?? "").trim().toLowerCase();
    if (!emailType) {
      if (/\b(reorder|re-order|more stock|order more)\b/.test(lower)) emailType = "reorder";
      else if (/\b(follow.?up|chase|status|where('?s| is)|update on|eta)\b/.test(lower)) emailType = "followup";
      else if (/\b(price|pricing|terms|wholesale|cost|discount)\b/.test(lower)) emailType = "price_query";
      else if (/\b(return|faulty|damaged|broken|defect)\b/.test(lower)) emailType = "return";
      else if (/\b(intro|introduce|new stockist|first time|opening)\b/.test(lower)) emailType = "intro";
      else emailType = "reorder";
    }

    const productDetails = String(params.product_details ?? "").trim() || userMessage;

    let userName = String(params.user_name ?? "").trim();
    let storeName = String(params.store_name ?? "").trim();
    if (!userName || !storeName) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          if (!userName) {
            const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
            userName = String(
              meta.first_name ?? meta.name ?? meta.full_name ?? user.email?.split("@")[0] ?? "",
            ).split(" ")[0];
          }
          if (!storeName) {
            const { data: uk } = await supabase
              .from("user_knowledge" as never)
              .select("store_name" as never)
              .eq("user_id" as never, user.id as never)
              .maybeSingle();
            storeName = (uk as { store_name?: string } | null)?.store_name ?? "";
          }
        }
      } catch {
        /* ignore */
      }
      if (!storeName) {
        try {
          storeName = getStoreConfig().name ?? "";
        } catch {
          /* ignore */
        }
      }
    }

    const toneVariant = Number(params.tone_variant ?? 0) || 0;

    try {
      const { data, error } = await supabase.functions.invoke("sonic-supplier-email", {
        body: {
          supplier_name: supplierName,
          email_type: emailType,
          product_details: productDetails,
          user_name: userName,
          store_name: storeName,
          tone_variant: toneVariant,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const subject: string = String(data?.subject ?? "Quick note");
      const body: string = String(data?.body ?? "");

      return {
        text: [`**Email to ${supplierName}**`, "", `**Subject:** ${subject}`, "", body].join("\n"),
        email: {
          supplierName,
          emailType,
          subject,
          body,
          productDetails,
          userName,
          storeName,
          toneVariant,
        },
      };
    } catch (e) {
      console.error("sonic-supplier-email failed:", e);
      return { text: "Couldn't reach the email writer — try again in a moment." };
    }
  }

  if (decision.action === "invoice_question") {
    const question = String(params.question ?? "").trim() || userMessage;
    try {
      const { data, error } = await supabase.functions.invoke("sonic-invoice-question", {
        body: { question },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const answer = String(data?.answer ?? "").trim();
      const quickReplies = [
        "What's the total cost?",
        "What's the total RRP?",
        "Which brands?",
        "What's the cheapest style?",
      ];
      if (!answer) return { text: "I couldn't get an answer for that — try rephrasing?", quickReplies };
      return { text: answer, quickReplies };
    } catch (e) {
      console.error("sonic-invoice-question failed:", e);
      return { text: "Couldn't read the last invoice — try again in a moment." };
    }
  }

  if (decision.action === "write_product_description") {
    const brandName =
      String(params.brand_name ?? params.brand ?? "").trim() ||
      detectBrand(userMessage) ||
      "";
    const colour =
      String(params.colour ?? params.color ?? "").trim() ||
      detectColour(userMessage) ||
      "";
    const productType =
      String(params.product_type ?? params.type ?? "").trim() ||
      detectProductType(userMessage) ||
      "";
    const productName =
      String(params.product_name ?? params.style_name ?? params.style ?? params.title ?? "").trim() ||
      detectProductName(userMessage, brandName, colour, productType) ||
      "";

    if (!brandName && !productName) {
      return {
        text: "Give me a brand and product name — e.g. 'description for Seafolly Mar26 in Black'.",
      };
    }

    // Features: from params or detected from message
    let features: string[] = [];
    if (Array.isArray(params.features)) {
      features = (params.features as unknown[]).map((f) => String(f)).filter(Boolean);
    }
    if (features.length === 0) {
      const lower = userMessage.toLowerCase();
      const featureMap: Array<[RegExp, string]> = [
        [/\bunderwire\b/, "underwire"],
        [/\bchlorine\s*resist(ant)?\b/, brandName.toLowerCase() === "funkita" ? "chlorine resistant" : "chlorine resist"],
        [/\bupf\b|\bsun\s*protection\b/, "UPF sun protection"],
        [/\breversible\b/, "reversible"],
        [/\btummy\s*control\b/, "tummy control"],
        [/\bplus\s*size\b|\b18\+\b/, "plus size"],
        [/\bmastectomy\b/, "mastectomy-friendly"],
        [/\b(swim ?dress)\b/, "swimdress silhouette"],
        [/\bd[-/]?g\b|\bfuller cup\b/, "D–G cup support"],
        [/\bremovable cups?\b/, "removable cups"],
        [/\badjustable straps?\b/, "adjustable straps"],
        [/\bhigh waist(ed)?\b/, "high-waisted"],
        [/\bhigh leg\b/, "high-leg cut"],
      ];
      for (const [re, label] of featureMap) {
        if (re.test(lower)) features.push(label);
      }
    }

    const lengthVariant: "default" | "shorter" | "longer" =
      params.length_variant === "shorter" || params.length_variant === "longer"
        ? (params.length_variant as "shorter" | "longer")
        : "default";

    try {
      const { data, error } = await supabase.functions.invoke("sonic-product-description", {
        body: {
          brand_name: brandName,
          product_name: productName,
          colour,
          product_type: productType,
          features,
          length_variant: lengthVariant,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const description = String(data?.description ?? "").trim();

      const heading = [brandName, productName].filter(Boolean).join(" ").trim();
      const headingLine = colour ? `${heading} — ${colour}` : heading;

      return {
        text: [
          `**${headingLine || "Product description"}**`,
          "──────────────────────────────────",
          description,
          "",
          `Character count: ${description.length} chars`,
        ].join("\n"),
        description: {
          brandName,
          productName,
          colour,
          productType,
          features,
          text: description,
          lengthVariant,
        },
      };
    } catch (e) {
      console.error("sonic-product-description failed:", e);
      return { text: "Couldn't reach the description writer — try again in a moment." };
    }
  }

  return null;
}
