// User-pinned Claude model for invoice parsing (Stage 1 PDF extraction).
// Stored in localStorage so the choice survives reloads without a DB write.

export const INVOICE_PARSER_MODELS = [
  {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5 (project default)",
    description: "Newer, generally better at PDF reading. Recommended.",
  },
  {
    id: "claude-sonnet-4-20250514",
    label: "Sonnet 4 (master prompt example)",
    description: "Matches the model in the Sonic Master Prompt v2 example.",
  },
] as const;

export type InvoiceParserModelId = (typeof INVOICE_PARSER_MODELS)[number]["id"];

const STORAGE_KEY = "sonic.invoiceParserClaudeModel";
export const DEFAULT_INVOICE_PARSER_MODEL: InvoiceParserModelId = "claude-sonnet-4-5-20250929";

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
