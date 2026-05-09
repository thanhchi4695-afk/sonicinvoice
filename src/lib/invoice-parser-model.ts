// User-pinned Claude model for invoice parsing (Stage 1 PDF extraction).
// Stored in localStorage so the choice survives reloads without a DB write.

export const INVOICE_PARSER_MODELS = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6 (project default)",
    description: "Latest Sonnet — ~30-50% faster, 1M context, near-Opus reasoning at Sonnet pricing.",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5 (fallback)",
    description: "Previous default. Used automatically if 4.6 is unreachable.",
  },
  {
    id: "claude-sonnet-4-20250514",
    label: "Sonnet 4 (legacy)",
    description: "Older snapshot. Kept for reproducing prior runs.",
  },
] as const;

export type InvoiceParserModelId = (typeof INVOICE_PARSER_MODELS)[number]["id"];

const STORAGE_KEY = "sonic.invoiceParserClaudeModel";
export const DEFAULT_INVOICE_PARSER_MODEL: InvoiceParserModelId = "claude-sonnet-4-6";

export function getInvoiceParserModel(): InvoiceParserModelId {
  if (typeof window === "undefined") return DEFAULT_INVOICE_PARSER_MODEL;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v && INVOICE_PARSER_MODELS.some((m) => m.id === v)) return v as InvoiceParserModelId;
  return DEFAULT_INVOICE_PARSER_MODEL;
}

export function setInvoiceParserModel(id: InvoiceParserModelId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, id);
}
