// Sonic chat action executor — Sprint 3.
// Maps the structured `action` returned by the intent classifier to real app side-effects.
// Only safe (requires_permission: false) actions run automatically here.

import { generateTags, type TagInput } from "@/lib/tag-engine";
import { generateSeo, type SeoProduct } from "@/lib/seo-engine";

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

export function runInlineAction(
  decision: SonicDecision,
  userMessage: string,
): string | null {
  if (!decision || !decision.action) return null;
  const params = decision.params ?? {};

  if (decision.action === "open_tag_builder") {
    const brand = String(params.brand ?? "").trim() || "Unknown Brand";
    const productType =
      String(params.product_type ?? params.type ?? "").trim() || "Bikini Tops";
    const input: TagInput = {
      title: `${brand} ${productType}`,
      brand,
      productType: titleCase(productType),
      priceStatus: "full_price",
      isNew: true,
      arrivalMonth: new Date().toLocaleString("en-AU", { month: "short", year: "2-digit" }).replace(" ", ""),
    };
    try {
      const tags = generateTags(input);
      return [
        `Tags for **${brand} — ${productType}**:`,
        "",
        tags.map((t) => `• ${t}`).join("\n"),
        "",
        `_Comma-separated:_ ${tags.join(", ")}`,
      ].join("\n");
    } catch (e) {
      console.error("tag generation failed:", e);
      return "Couldn't generate tags — try again with a brand and product type (e.g. 'tags for Seafolly Bikini Tops').";
    }
  }

  if (decision.action === "open_seo_writer") {
    const brand = String(params.brand ?? "").trim();
    const productType = String(params.product_type ?? params.type ?? "").trim();
    const colour = String(params.colour ?? params.color ?? "").trim();
    const titleFromParams = String(params.title ?? "").trim();
    const fallbackTitle =
      titleFromParams ||
      [brand, colour, productType].filter(Boolean).join(" ") ||
      userMessage.slice(0, 60);
    const product: SeoProduct = {
      title: fallbackTitle || "Product",
      brand: brand || "Brand",
      type: productType || "Product",
      tags: colour ? [colour] : [],
      description: userMessage,
    };
    try {
      const seo = generateSeo(product);
      return [
        `**SEO Title** (${seo.titleLength} chars${seo.titleOver ? " ⚠ over limit" : ""})`,
        seo.seoTitle,
        "",
        `**Meta Description** (${seo.descLength} chars${seo.descOver ? " ⚠ over limit" : ""})`,
        seo.seoDescription,
      ].join("\n");
    } catch (e) {
      console.error("SEO generation failed:", e);
      return "Couldn't generate SEO — give me a brand, product type, and colour to work from.";
    }
  }

  return null;
}
