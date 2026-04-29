import { AlertTriangle, ShieldAlert, MessageSquare, Mail, Wand2, FileText, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MarginRule } from "./types";

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  icon: typeof AlertTriangle;
  /** A partial rule used to seed the builder. Saved with full validation when the user clicks Save. */
  seed: Pick<MarginRule, "name" | "is_active" | "conditions" | "actions" | "priority">;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "low_margin_alert",
    name: "Low-margin Slack alert",
    description: "Notify the buying team in Slack when any line lands below 55% margin.",
    icon: MessageSquare,
    seed: {
      name: "Low-margin Slack alert",
      is_active: true,
      priority: 0,
      conditions: {
        kind: "group",
        operator: "AND",
        children: [{ field: "margin_pct", operator: "is_below", value: 55 }],
      },
      actions: [
        { type: "slack_approval", params: { channel: "#buying-team" } },
      ],
    },
  },
  {
    id: "block_below_floor",
    name: "Block checkout below 45% margin",
    description: "Hard-stop any PO line that would land below the strict margin floor.",
    icon: ShieldAlert,
    seed: {
      name: "Block checkout below 45% margin",
      is_active: true,
      priority: 0,
      conditions: {
        kind: "group",
        operator: "AND",
        children: [{ field: "margin_pct", operator: "is_below", value: 45 }],
      },
      actions: [{ type: "block_checkout" }],
    },
  },
  {
    id: "auto_correct_to_60",
    name: "Auto-correct to 60% target margin",
    description: "Suggest a corrected price when margin slips between 45–58%.",
    icon: Wand2,
    seed: {
      name: "Auto-correct to 60% target margin",
      is_active: true,
      priority: 0,
      conditions: {
        kind: "group",
        operator: "AND",
        children: [{ field: "margin_pct", operator: "is_between", value: [45, 58] }],
      },
      actions: [
        { type: "price_correction", params: { target_margin: 60, message: "Auto-corrected to protect 60% margin floor." } },
      ],
    },
  },
  {
    id: "high_value_email",
    name: "Email approval for large POs",
    description: "Send an email when a PO total exceeds $25,000.",
    icon: Mail,
    seed: {
      name: "High-value PO email approval",
      is_active: true,
      priority: 0,
      conditions: {
        kind: "group",
        operator: "AND",
        children: [{ field: "po_total", operator: "is_above", value: 25000 }],
      },
      actions: [
        { type: "email_notify", params: { email: "", subject: "High-value PO needs approval" } },
      ],
    },
  },
  {
    id: "log_only",
    name: "Log-only audit trail",
    description: "Silently log every line — useful for monitoring without any user-facing action.",
    icon: FileText,
    seed: {
      name: "Log-only audit trail",
      is_active: true,
      priority: 0,
      conditions: {
        kind: "group",
        operator: "AND",
        children: [{ field: "margin_pct", operator: "is_below", value: 100 }],
      },
      actions: [{ type: "log_only" }],
    },
  },
];

interface RuleTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (seed: RuleTemplate["seed"] | null) => void;
}

export function RuleTemplatePicker({ open, onOpenChange, onPick }: RuleTemplatePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Pick a starting point — you can edit conditions and actions before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex items-start gap-3 rounded-md border border-dashed border-border p-3 text-left transition-colors hover:bg-muted dark:hover:bg-gray-800"
          >
            <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
              <Plus className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Blank rule</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Start from an empty condition group.
              </div>
            </div>
          </button>

          {RULE_TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onPick(tpl.seed)}
                className="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted dark:hover:bg-gray-800"
              >
                <div className="mt-0.5 rounded-md bg-amber-500/10 p-2 text-amber-500">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{tpl.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {tpl.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
