// Zod validators for the Margin Guardian rule shape.
// Mirrors src/components/guardian/types.ts. Validation happens before any DB write.
//
// `conditions` is polymorphic: either a flat AND-array of conditions (legacy) or a
// single root group `{ kind: "group", operator, children: [...] }` for nested AND/OR.

import { z } from "zod";
import { MAX_GROUP_DEPTH } from "./types";

const textOperator = z.enum(["is", "is_not", "contains", "starts_with", "in", "not_in"]);
const numberOperator = z.enum(["is_below", "is_above", "is_between", "equals"]);

const conditionSchema = z
  .object({
    field: z.enum(["brand", "vendor", "sku", "product_category", "margin_pct", "po_total", "quantity", "surface"]),
    operator: z.union([textOperator, numberOperator]),
    value: z.union([
      z.string().min(1, "Value required").max(255),
      z.number().finite(),
      z.array(z.union([z.string().min(1).max(255), z.number().finite()])).min(1).max(50),
      z.tuple([z.number().finite(), z.number().finite()]),
    ]),
  })
  .superRefine((cond, ctx) => {
    const numberFields = ["margin_pct", "po_total", "quantity"];
    const textOps = ["is", "is_not", "contains", "starts_with", "in", "not_in"];
    const numOps = ["is_below", "is_above", "is_between", "equals"];

    if (numberFields.includes(cond.field) && !numOps.includes(cond.operator)) {
      ctx.addIssue({ code: "custom", message: "Operator does not apply to a numeric field" });
    }
    if (!numberFields.includes(cond.field) && !textOps.includes(cond.operator)) {
      ctx.addIssue({ code: "custom", message: "Operator does not apply to a text field" });
    }
    if (cond.operator === "is_between" && !(Array.isArray(cond.value) && cond.value.length === 2)) {
      ctx.addIssue({ code: "custom", message: "is_between requires two values" });
    }
  });

// Recursive group schema. z.lazy() gives us a self-reference for nested children.
type ConditionNodeShape =
  | z.infer<typeof conditionSchema>
  | { kind: "group"; operator: "AND" | "OR"; children: ConditionNodeShape[] };

// Use ZodTypeAny to sidestep the recursive type-inference limitation in Zod 3.
const groupSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    kind: z.literal("group"),
    operator: z.enum(["AND", "OR"]),
    children: z.array(z.union([conditionSchema, groupSchema])).min(1, "Group needs at least one condition").max(20),
  }),
);

function depth(node: ConditionNodeShape): number {
  if (!(node as any).kind) return 1;
  const g = node as { children: ConditionNodeShape[] };
  return 1 + Math.max(0, ...g.children.map(depth));
}

function leafCount(node: ConditionNodeShape): number {
  if (!(node as any).kind) return 1;
  return (node as { children: ConditionNodeShape[] }).children.reduce((acc, c) => acc + leafCount(c), 0);
}

const conditionsField = z.union([
  z.array(conditionSchema).min(1, "Add at least one condition").max(20),
  groupSchema.superRefine((root, ctx) => {
    if (depth(root) > MAX_GROUP_DEPTH) {
      ctx.addIssue({ code: "custom", message: `Groups can be nested at most ${MAX_GROUP_DEPTH} levels deep` });
    }
    const total = leafCount(root);
    if (total < 1) ctx.addIssue({ code: "custom", message: "Add at least one condition" });
    if (total > 20) ctx.addIssue({ code: "custom", message: "Maximum 20 conditions per rule" });
  }),
]);

// Slack channel/DM target: must start with # (channel) or @ (user/IM),
// then 1–80 lowercase letters/numbers/dashes/underscores/dots.
const slackChannelRegex = /^[#@][a-z0-9._-]{1,80}$/;

const actionSchema = z
  .object({
    type: z.enum(["block_checkout", "slack_approval", "email_notify", "price_correction", "log_only"]),
    params: z
      .object({
        channel: z.string().regex(slackChannelRegex, "Channel must start with # or @").optional(),
        email: z.string().email("Invalid email").max(255).optional(),
        subject: z.string().max(200).optional(),
        target_margin: z.number().min(0).max(100).optional(),
        message: z.string().max(500).optional(),
      })
      .optional(),
  })
  .superRefine((action, ctx) => {
    if (action.type === "slack_approval" && !action.params?.channel) {
      ctx.addIssue({ code: "custom", message: "Slack channel is required" });
    }
    if (action.type === "email_notify" && !action.params?.email) {
      ctx.addIssue({ code: "custom", message: "Recipient email is required" });
    }
    if (action.type === "price_correction" && action.params?.target_margin === undefined) {
      ctx.addIssue({ code: "custom", message: "Target margin % is required" });
    }
  });

export const ruleSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required").max(100, "Rule name too long"),
  is_active: z.boolean(),
  conditions: conditionsField,
  actions: z.array(actionSchema).min(1, "Add at least one action").max(10),
  priority: z.number().int().min(0).max(9999),
});

export type ValidatedRule = z.infer<typeof ruleSchema>;
