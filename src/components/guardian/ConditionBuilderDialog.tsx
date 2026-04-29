import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { ActionsSection } from "./ActionsSection";
import { ConditionGroupBlock } from "./ConditionGroupBlock";
import { TestRuleDialog } from "./TestRuleDialog";
import { TestWithCurrentCartDialog } from "./TestWithCurrentCartDialog";
import { useMarginRules } from "./use-margin-rules";
import { useRuleValidation } from "./use-rule-validation";
import {
  serializeConditions,
  toRootGroup,
  type ConditionGroup,
  type DraftRule,
  type MarginRule,
  type RuleAction,
  type RuleCondition,
} from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: MarginRule | null;
  defaultPriority?: number;
}

const EMPTY_CONDITION: RuleCondition = { field: "brand", operator: "is", value: "" };
const EMPTY_ACTION: RuleAction = { type: "block_checkout" };

interface DraftState extends Omit<DraftRule, "conditions"> {
  rootGroup: ConditionGroup;
}

function toDraft(rule?: MarginRule | null, defaultPriority = 0): DraftState {
  if (rule) {
    return {
      id: rule.id,
      name: rule.name,
      is_active: rule.is_active,
      rootGroup: toRootGroup(rule.conditions),
      actions: rule.actions,
      priority: rule.priority,
    };
  }
  return {
    name: "",
    is_active: true,
    rootGroup: { kind: "group", operator: "AND", children: [{ ...EMPTY_CONDITION }] },
    actions: [EMPTY_ACTION],
    priority: defaultPriority,
  };
}

export function ConditionBuilderDialog({ open, onOpenChange, rule, defaultPriority = 0 }: Props) {
  const { saveRule, deleteRule } = useMarginRules();
  const [draft, setDraft] = useState<DraftState>(toDraft(rule, defaultPriority));
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [liveTestOpen, setLiveTestOpen] = useState(false);

  useEffect(() => {
    if (open) setDraft(toDraft(rule, defaultPriority));
  }, [open, rule, defaultPriority]);

  // Build the persisted shape: flatten to legacy array if no OR groups, otherwise keep root group.
  const persisted = useMemo<DraftRule>(
    () => ({
      id: draft.id,
      name: draft.name,
      is_active: draft.is_active,
      priority: draft.priority,
      actions: draft.actions,
      conditions: serializeConditions(draft.rootGroup),
    }),
    [draft],
  );

  const validation = useRuleValidation(persisted, draft.rootGroup);
  const isValid = validation.isValid;
  const nameError = validation.errorAt("name");
  const actionsError = validation.errorAt("actions");

  const handleSave = async () => {
    setSaving(true);
    const res: { ok: boolean; error?: string } = await saveRule(persisted);
    setSaving(false);
    if (res.ok) {
      toast.success(draft.id ? "Rule updated" : "Rule created");
      onOpenChange(false);
    } else {
      toast.error(res.error ?? "Save failed");
    }
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    if (!confirm("Delete this rule? Decision history is preserved.")) return;
    const res: { ok: boolean; error?: string } = await deleteRule(draft.id);
    if (!res.ok) {
      toast.error(res.error ?? "Delete failed");
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
                  className={nameError ? "border-destructive" : ""}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "rule-name-error" : undefined}
                />
                {nameError && (
                  <p id="rule-name-error" className="mt-1 text-xs text-destructive">
                    {nameError}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {draft.name.trim().length}/100
                </p>
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
              <div className="mb-2 text-sm font-medium">
                WHEN these conditions match (use groups for AND/OR logic):
              </div>
              <ConditionGroupBlock
                group={draft.rootGroup}
                isRoot
                onChange={(next) => setDraft({ ...draft, rootGroup: next })}
                errorAt={validation.errorAt}
              />
            </section>

            <section>
              <div className="mb-2 text-sm font-medium">THEN take these actions:</div>
              <ActionsSection
                actions={draft.actions}
                onChange={(next) => setDraft({ ...draft, actions: next })}
                errorAt={validation.errorAt}
                actionsError={actionsError}
              />
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

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="order-2 sm:order-1">
              {draft.id && (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full text-destructive sm:w-auto"
                >
                  Delete rule
                </Button>
              )}
            </div>
            <div className="order-1 flex flex-col items-stretch gap-2 sm:order-2 sm:flex-row sm:items-center">
              {!isValid && validation.issues.length > 0 && (
                <span className="text-xs text-destructive sm:mr-1">
                  Fix {validation.issues.length} issue{validation.issues.length === 1 ? "" : "s"} to save
                </span>
              )}
              <Button
                variant="outline"
                onClick={() => setLiveTestOpen(true)}
                disabled={!isValid || saving}
                title="Run this rule against the live JOOR / NuOrder cart in your browser"
              >
                Test with current cart
              </Button>
              <Button
                variant="outline"
                onClick={() => setTestOpen(true)}
                disabled={!isValid || saving}
              >
                Test rule
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!isValid || saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TestRuleDialog open={testOpen} onOpenChange={setTestOpen} rule={persisted} />
      <TestWithCurrentCartDialog
        open={liveTestOpen}
        onOpenChange={setLiveTestOpen}
        rule={persisted}
      />
    </>
  );
}
