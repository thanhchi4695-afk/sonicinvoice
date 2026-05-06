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
  "history",
  "flywheel",
  "analytics",
  "settings",
  "account",
  "tools",
  "invoices",
]);

function navigateTab(tab: string) {
  const target = tab === "settings" ? "account" : tab;
  window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: target }));
}

function navigateFlow(flow: string) {
  window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: flow }));
}

/**
 * Execute an action returned by the Sonic intent classifier.
 * Returns true if a side-effect was performed, false otherwise (e.g. explain/none).
 */
export function executeChatAction(decision: SonicDecision): boolean {
  if (!decision || !decision.action) return false;
  if (decision.requires_permission) return false; // gated — handled by permission UI in Sprint 4
  const params = decision.params ?? {};

  switch (decision.action) {
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
      const mode = String(params.mode ?? "pdf").toLowerCase();
      if (mode === "email") {
        navigateFlow("email_inbox");
      } else {
        // pdf, photo, excel all funnel into the invoice flow
        navigateFlow("invoice");
      }
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
      navigateTab("flywheel");
      return true;
    case "list_trained_brands":
      navigateTab("flywheel");
      return true;
    case "open_correction_ui":
      navigateTab("history");
      return true;
    case "scan_email_inbox":
      navigateFlow("email_inbox");
      return true;
    case "explain":
    case "none":
    default:
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
    default:
      return false;
  }
}
