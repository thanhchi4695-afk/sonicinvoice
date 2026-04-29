import { useEffect, useState } from "react";
import { Plus, GripVertical, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConditionBuilderDialog } from "./ConditionBuilderDialog";
import { RuleTemplatePicker, type RuleTemplate } from "./RuleTemplatePicker";
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

interface SortableRuleProps {
  rule: MarginRule;
  index: number;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
}

function SortableRule({ rule, index, onToggle, onEdit }: SortableRuleProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto" as const,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-md border bg-card p-4 ${isDragging ? "border-primary shadow-lg" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${rule.name}`}
          className="mt-1 flex h-7 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">#{index + 1}</Badge>
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
            onCheckedChange={onToggle}
            aria-label="Active"
          />
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </div>
      </div>
    </li>
  );
}

export function RuleListPage() {
  const { rules, loading, toggleActive, reorder } = useMarginRules();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [template, setTemplate] = useState<RuleTemplate["seed"] | null>(null);
  const [editing, setEditing] = useState<MarginRule | null>(null);
  // Local mirror of order for optimistic drag-and-drop UX.
  const [localRules, setLocalRules] = useState<MarginRule[]>(rules);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    if (!reordering) setLocalRules(rules);
  }, [rules, reordering]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require ~5px of movement so click-to-edit on adjacent buttons isn't hijacked.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localRules.findIndex((r) => r.id === active.id);
    const newIndex = localRules.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(localRules, oldIndex, newIndex);
    const previous = localRules;

    // Optimistic update
    setLocalRules(next);
    setReordering(true);
    try {
      const res: { ok: boolean; error?: string } = await reorder(next.map((r) => r.id));
      if (!res.ok) {
        setLocalRules(previous);
        toast.error(res.error ?? "Reorder failed");
      } else {
        toast.success("Rule order updated");
      }
    } catch (err) {
      setLocalRules(previous);
      toast.error(err instanceof Error ? err.message : "Reorder failed");
    } finally {
      setReordering(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Guardian Rules</h1>
          <p className="text-sm text-muted-foreground">
            No-code margin protection rules. Drag the handle to reorder — lower priority numbers run first.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setTemplate(null); setPickerOpen(true); }}>
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
        </div>
      ) : localRules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rules yet. Create your first guardian rule to start protecting margins.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localRules.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-2">
              {localRules.map((rule, i) => (
                <SortableRule
                  key={rule.id}
                  rule={rule}
                  index={i}
                  onToggle={async (v) => {
                    const res: { ok: boolean; error?: string } = await toggleActive(rule.id, v);
                    if (!res.ok) toast.error(res.error ?? "Update failed");
                  }}
                  onEdit={() => { setEditing(rule); setOpen(true); }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <ConditionBuilderDialog
        open={open}
        onOpenChange={setOpen}
        rule={editing}
        defaultPriority={localRules.length}
      />
    </div>
  );
}
