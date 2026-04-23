// Single source of truth for the invoice pipeline step labels (#2).
// Used by both the dashboard chrome and the InvoiceFlow wizard so users see
// the same vocabulary everywhere.

export interface PipelineStep {
  key: "upload" | "extract" | "review" | "stock_check" | "enrich" | "export";
  label: string;
  tooltip: string;
}

export const PIPELINE_STEPS: readonly PipelineStep[] = [
  { key: "upload",      label: "Upload",      tooltip: "Choose invoice file" },
  { key: "extract",     label: "Extract",     tooltip: "AI reads the lines" },
  { key: "review",      label: "Review",      tooltip: "Verify & correct" },
  { key: "stock_check", label: "Stock check", tooltip: "Refill vs new colour vs new product" },
  { key: "enrich",      label: "Enrich",      tooltip: "Brand, colour, product type" },
  { key: "export",      label: "Export",      tooltip: "Shopify / Lightspeed CSV" },
] as const;
