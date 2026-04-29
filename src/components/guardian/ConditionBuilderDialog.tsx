import { useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConditionRow } from "./ConditionRow";
import { ActionRow } from "./ActionRow";
import { TestRuleDialog } from "./TestRuleDialog";
import { useMarginRules } from "./use-margin-rules";
import { ruleSchema } from "./rule-schema";
import type { DraftRule, MarginRule, RuleAction, RuleCondition } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: MarginRule | null;
  defaultPriority?: number;
}

const EMPTY_CONDITION: RuleCondition = { field: "brand", operator: "is", value: "" };
const EMPTY_ACTION: RuleAction = { type: "block_checkout" };

function toDraft(rule?: MarginRule | null, defaultPriority = 0): DraftRule {
  if (rule) {
    return {
      id: rule.id,
      name: rule.name,
      is_active: rule.is_active,
      conditions: rule.conditions,
      actions: rule.actions,
      priority: rule.priority,
    };
  }
  return {
    name: "",
    is_active: true,
    conditions: [EMPTY_CONDITION],
    actions: [EMPTY_ACTION],
    priority: defaultPriority,
  };
}

export function ConditionBuilderDialog({ open, onOpenChange, rule, defaultPriority = 0 }: Props) {
  const { saveRule, deleteRule } = useMarginRules();
  const [draft, setDraft] = useState<DraftRule>(toDraft(rule, defaultPriority));
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    if (open) setDraft(toDraft(rule, defaultPriority));
  }, [open, rule, defaultPriority]);

  const isValid = ruleSchema.safeParse(draft).success;

  const handleSave = async () => {
    setSaving(true);
    const res = await saveRule(draft);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(draft.id ? "Rule updated" : "Rule created");
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    if (!confirm("Delete this rule? Decision history is preserved.")) return;
    const res = await deleteRule(draft.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Rule deleted");
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit rule" : "New guardian rule"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[240px]">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input
                  id="rule-name"
                  value={draft.name}
                  maxLength={100}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Prevent low-margin Brand X orders"
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  id="rule-active"
                  checked={draft.is_active}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                />
                <Label htmlFor="rule-active">Active</Label>
              </div>
            </div>

            <section>
              <div className="mb-2 text-sm font-medium">WHEN all of these conditions are met:</div>
              <div className="space-y-2">
                {draft.conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    condition={c}
                    index={i}
                    onChange={(next) => {
                      const copy = [...draft.conditions];
                      copy[i] = next;
                      setDraft({ ...draft, conditions: copy });
                    }}
                    onRemove={() =>
                      setDraft({ ...draft, conditions: draft.conditions.filter((_, idx) => idx !== i) })
                    }
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { ...EMPTY_CONDITION }] })}
              >
                <Plus className="h-4 w-4" />
                Add condition
              </Button>
            </section>

            <section>
              <div className="mb-2 text-sm font-medium">THEN take these actions:</div>
              <div className="space-y-2">
                {draft.actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    onChange={(next) => {
                      const copy = [...draft.actions];
                      copy[i] = next;
                      setDraft({ ...draft, actions: copy });
                    }}
                    onRemove={() =>
                      setDraft({ ...draft, actions: draft.actions.filter((_, idx) => idx !== i) })
                    }
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setDraft({ ...draft, actions: [...draft.actions, { ...EMPTY_ACTION }] })}
              >
                <Plus className="h-4 w-4" />
                Add action
              </Button>
            </section>

            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
              <Label htmlFor="rule-priority" className="text-xs">
                Priority (lower runs first)
              </Label>
              <Input
                id="rule-priority"
                type="number"
                min={0}
                max={9999}
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                className="w-24"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {draft.id && (
                <Button variant="ghost" onClick={handleDelete} className="text-destructive">
                  Delete rule
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={!isValid}>
                Test rule
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!isValid || saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TestRuleDialog open={testOpen} onOpenChange={setTestOpen} rule={draft} />
    </>
  );
}
