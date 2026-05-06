// Sonic chat action executor — Sprint 3.
// Maps the structured `action` returned by the intent classifier to real app side-effects.
// Only safe (requires_permission: false) actions run automatically here.

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

const VALID_TABS = new Set([
  "home",
  "invoices",
  "products",
  "marketing",
  "tools",
  "history",
  "flywheel",
  "analytics",
  "settings",
  "account",
]);

function navigateTab(tab: string) {
  const target = tab === "settings" ? "account" : tab;
  window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: target }));
}

function navigateFlow(flow: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new CustomEvent("sonic:navigate-flow", { detail: params ? { id: flow, params } : flow }),
  );
}

// Map of action_key → { tab?, flow? } so each action sets the right tab + flow.
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
  open_order_forms: { tab: "invoices", flow: "order_forms" },
  open_accounting_push: { tab: "invoices", flow: "accounting_push" },
  open_stock_check: { tab: "invoices", flow: "stock_check" },

  // Products tab
  open_inventory_hub: { tab: "products", flow: "inventory_view" },
  open_stock_monitor: { tab: "products", flow: "stock_monitor" },
  open_restock_analytics: { tab: "products", flow: "restock_analytics" },
  open_reorder: { tab: "products", flow: "reorder" },
  open_inventory_planning: { tab: "products", flow: "inventory_planning" },
  open_price_adjustment: { tab: "products", flow: "price_adjustment" },
  open_price_lookup: { tab: "products", flow: "price_lookup" },
  open_margin_protection: { tab: "products", flow: "margin_protection" },
  open_markdown_ladders: { tab: "products", flow: "markdown_ladders" },
  open_pl_analysis: { tab: "products", flow: "pl_analysis" },
  open_bulk_sale: { tab: "products", flow: "bulk_sale" },
  open_product_health: { tab: "products", flow: "product_health" },
  open_style_grouping: { tab: "products", flow: "style_grouping" },
  open_seasons: { tab: "products", flow: "seasons" },
  open_image_optimisation: { tab: "products", flow: "image_optimisation" },
  open_catalog_memory: { tab: "products", flow: "catalog_memory" },
  open_supplier_performance: { tab: "products", flow: "supplier_performance" },
  open_suppliers: { tab: "products", flow: "suppliers" },
  open_lightspeed_converter: { tab: "products", flow: "lightspeed_converter" },
  open_order_sync: { tab: "products", flow: "order_sync" },

  // Marketing tab
  open_feed_health: { tab: "marketing", flow: "feed_health" },
  open_feed_optimisation: { tab: "marketing", flow: "feed_optimisation" },
  open_google_colours: { tab: "marketing", flow: "google_colours" },
  open_google_ads_attributes: { tab: "marketing", flow: "google_ads_attributes" },
  open_google_ads_setup: { tab: "marketing", flow: "google_ads_setup" },
  open_meta_ads_setup: { tab: "marketing", flow: "meta_ads_setup" },
  open_performance_dashboard: { tab: "marketing", flow: "performance_dashboard" },
  open_competitor_intel: { tab: "marketing", flow: "competitor_intel" },
  open_organic_seo: { tab: "marketing", flow: "organic_seo" },
  open_collection_seo: { tab: "marketing", flow: "collection_seo" },
  open_geo_agentic: { tab: "marketing", flow: "geo_agentic" },
  open_collab_seo: { tab: "marketing", flow: "collab_seo" },
  open_social_media: { tab: "marketing", flow: "social_media" },

  // Tools tab
  open_tag_builder: { tab: "tools", flow: "tag_builder" },
  open_seo_writer: { tab: "tools", flow: "seo_writer" },
  open_export_collections: { tab: "tools", flow: "export_collections" },
  open_import_collections: { tab: "tools", flow: "import_collections" },
  open_auto_collections: { tab: "tools", flow: "auto_collections" },
  open_collection_seo_ai: { tab: "tools", flow: "collection_seo_ai" },
  open_image_downloader: { tab: "tools", flow: "image_downloader" },
  open_google_feed_preview: { tab: "tools", flow: "google_feed_preview" },
  open_ai_instructions: { tab: "tools", flow: "ai_instructions" },
  open_learning_memory: { tab: "tools", flow: "learning_memory" },
  open_supplier_email_templates: { tab: "tools", flow: "supplier_email_templates" },
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
    if (tab) navigateTab(tab);
    if (flow) navigateFlow(flow, params);
    return true;
  }

  switch (action) {
    case "navigate_tab": {
      const tab = String(params.tab ?? "").toLowerCase();
      if (VALID_TABS.has(tab)) {
        navigateTab(tab);
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
