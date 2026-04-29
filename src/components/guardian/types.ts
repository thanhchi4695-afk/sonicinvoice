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

// ── Nested groups (AND/OR) ──
// A group is a logical container with an operator and an ordered list of children.
// Each child is either a leaf condition or another nested group.
export type GroupOperator = "AND" | "OR";

export interface ConditionGroup {
  kind: "group";
  operator: GroupOperator;
  children: ConditionNode[];
}

export type ConditionNode = ConditionGroup | RuleCondition;

export const MAX_GROUP_DEPTH = 3;

export function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).kind === "group";
}

/** A rule's conditions can be stored as either a flat AND-array (legacy) or as a single root group. */
export type RuleConditionsField = RuleCondition[] | ConditionGroup;

/** True if the field is a single root group object, false for legacy flat array. */
export function isGroupField(value: RuleConditionsField): value is ConditionGroup {
  return !Array.isArray(value) && (value as ConditionGroup)?.kind === "group";
}

/** Wrap an existing flat AND-array (or empty) in a root AND group for editing. */
export function toRootGroup(value: RuleConditionsField | undefined): ConditionGroup {
  if (!value) return { kind: "group", operator: "AND", children: [] };
  if (isGroupField(value)) return value;
  return { kind: "group", operator: "AND", children: value as RuleCondition[] };
}

/** Recursively check whether a tree contains any OR group. If not, it can be flattened to legacy shape. */
export function containsOr(node: ConditionNode): boolean {
  if (!isGroup(node)) return false;
  if (node.operator === "OR" && node.children.length > 1) return true;
  return node.children.some(containsOr);
}

/** Flatten a pure-AND tree into a flat array of leaf conditions (legacy storage shape). */
export function flattenLeaves(node: ConditionNode): RuleCondition[] {
  if (!isGroup(node)) return [node];
  return node.children.flatMap(flattenLeaves);
}

/** Count total leaf conditions in a tree (used for limits & validation). */
export function countLeaves(node: ConditionNode): number {
  return flattenLeaves(node).length;
}

/** Decide the final on-disk shape for the rule's conditions field. */
export function serializeConditions(root: ConditionGroup): RuleConditionsField {
  if (containsOr(root)) return root;
  return flattenLeaves(root);
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
  conditions: RuleConditionsField;
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
