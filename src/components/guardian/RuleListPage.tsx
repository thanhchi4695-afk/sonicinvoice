import { useState } from "react";
import { Plus, ChevronUp, ChevronDown, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConditionBuilderDialog } from "./ConditionBuilderDialog";
import { useMarginRules } from "./use-margin-rules";
import {
  ACTION_LABELS,
  FIELD_LABELS,
  isGroup,
  isGroupField,
  type ConditionNode,
  type MarginRule,
  type RuleCondition,
} from "./types";

function summarizeNode(node: ConditionNode): string {
  if (isGroup(node)) {
    if (node.children.length === 0) return "(empty)";
    const inner = node.children.map(summarizeNode).join(` ${node.operator} `);
    return node.children.length > 1 ? `(${inner})` : inner;
  }
  const c = node as RuleCondition;
  const v = Array.isArray(c.value) ? c.value.join("/") : c.value;
  return `${FIELD_LABELS[c.field]} ${c.operator.replace(/_/g, " ")} ${v}`;
}

function summarizeConditions(rule: MarginRule): string {
  if (isGroupField(rule.conditions)) return summarizeNode(rule.conditions);
  return (rule.conditions as RuleCondition[])
    .map((c) => summarizeNode(c))
    .join(" AND ");
}

export function RuleListPage() {
  const { rules, loading, toggleActive, reorder } = useMarginRules();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MarginRule | null>(null);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    const ordered = [...rules];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const res: { ok: boolean; error?: string } = await reorder(ordered.map((r) => r.id));
    if (!res.ok) toast.error(res.error ?? "Reorder failed");
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Guardian Rules</h1>
          <p className="text-sm text-muted-foreground">
            No-code margin protection rules. Lower priority numbers run first.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rules yet. Create your first guardian rule to start protecting margins.
        </div>
      ) : (
        <ol className="space-y-2">
          {rules.map((rule, i) => (
            <li key={rule.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">#{i + 1}</Badge>
                    <span className="font-medium">{rule.name}</span>
                    {rule.is_active ? (
                      <Badge className="bg-primary/15 text-primary">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Paused</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    WHEN {summarizeConditions(rule)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">
                    THEN {rule.actions.map((a) => ACTION_LABELS[a.type]).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={async (v) => {
                      const res: { ok: boolean; error?: string } = await toggleActive(rule.id, v);
                      if (!res.ok) toast.error(res.error ?? "Update failed");
                    }}
                    aria-label="Active"
                  />
                  <Button variant="outline" size="sm" onClick={() => { setEditing(rule); setOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ConditionBuilderDialog
        open={open}
        onOpenChange={setOpen}
        rule={editing}
        defaultPriority={rules.length}
      />
    </div>
  );
}
