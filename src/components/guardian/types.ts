// Shared types for the Margin Guardian Condition Builder.
// Locked enums per .lovable/plan.md Appendix D.3 / D.4. Extending requires migration.

export type ConditionField =
  | "brand"
  | "vendor"
  | "sku"
  | "product_category"
  | "margin_pct"
  | "po_total"
  | "quantity"
  | "surface";

export type TextOperator = "is" | "is_not" | "contains" | "starts_with" | "in" | "not_in";
export type NumberOperator = "is_below" | "is_above" | "is_between" | "equals";

export type ConditionOperator = TextOperator | NumberOperator;

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  // For most operators: string | number. For is_between: [number, number]. For in/not_in: string[].
  value: string | number | (string | number)[] | [number, number];
}

export type ActionType =
  | "block_checkout"
  | "slack_approval"
  | "email_notify"
  | "price_correction"
  | "log_only";

export interface RuleAction {
  type: ActionType;
  // Action-specific config — validated per type.
  params?: {
    channel?: string;        // slack_approval
    email?: string;          // email_notify
    subject?: string;        // email_notify
    target_margin?: number;  // price_correction
    message?: string;        // price_correction
  };
}

export interface MarginRule {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  created_at: string;
  updated_at: string;
}

export type DraftRule = Omit<MarginRule, "id" | "user_id" | "created_at" | "updated_at"> & {
  id?: string;
};

export const FIELD_LABELS: Record<ConditionField, string> = {
  brand: "Brand",
  vendor: "Vendor",
  sku: "SKU",
  product_category: "Product category",
  margin_pct: "Margin %",
  po_total: "Total PO value",
  quantity: "Quantity",
  surface: "Surface",
};

export const TEXT_FIELDS: ConditionField[] = ["brand", "vendor", "sku", "product_category", "surface"];
export const NUMBER_FIELDS: ConditionField[] = ["margin_pct", "po_total", "quantity"];

export const TEXT_OPERATORS: { value: TextOperator; label: string }[] = [
  { value: "is", label: "is exactly" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is none of" },
];

export const NUMBER_OPERATORS: { value: NumberOperator; label: string }[] = [
  { value: "is_below", label: "is below" },
  { value: "is_above", label: "is above" },
  { value: "is_between", label: "is between" },
  { value: "equals", label: "equals" },
];

export const ACTION_LABELS: Record<ActionType, string> = {
  block_checkout: "Block checkout",
  slack_approval: "Send Slack approval request",
  email_notify: "Send email notification",
  price_correction: "Auto-apply price correction (requires confirmation)",
  log_only: "Log only (no user-facing action)",
};

export const SURFACE_OPTIONS = ["joor", "nuorder", "po", "email", "invoice_review"] as const;

export function operatorsForField(field: ConditionField) {
  return NUMBER_FIELDS.includes(field) ? NUMBER_OPERATORS : TEXT_OPERATORS;
}

export function isNumberField(field: ConditionField) {
  return NUMBER_FIELDS.includes(field);
}
