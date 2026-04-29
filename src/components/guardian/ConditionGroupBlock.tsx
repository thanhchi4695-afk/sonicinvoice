// Recursive group renderer. A group has an AND/OR operator and children, where each
// child is either a leaf condition (rendered with <ConditionRow/>) or another group.
// The root group lives at depth 0 and cannot be removed.
import { Plus, Trash2, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConditionRow } from "./ConditionRow";
import {
  MAX_GROUP_DEPTH,
  isGroup,
  type ConditionGroup,
  type ConditionNode,
  type GroupOperator,
  type RuleCondition,
} from "./types";

const EMPTY_CONDITION: RuleCondition = { field: "brand", operator: "is", value: "" };

interface Props {
  group: ConditionGroup;
  onChange: (next: ConditionGroup) => void;
  onRemove?: () => void; // undefined for root
  depth?: number;
  isRoot?: boolean;
  /** Dot-joined index trail from the root group (root = ""). */
  trail?: string;
  /** Error lookup keyed on UI paths produced by use-rule-validation. */
  errorAt?: (path: string) => string | undefined;
}

export function ConditionGroupBlock({
  group,
  onChange,
  onRemove,
  depth = 0,
  isRoot = false,
  trail = "",
  errorAt,
}: Props) {
  const updateChild = (idx: number, next: ConditionNode) => {
    const children = [...group.children];
    children[idx] = next;
    onChange({ ...group, children });
  };

  const removeChild = (idx: number) => {
    onChange({ ...group, children: group.children.filter((_, i) => i !== idx) });
  };

  const addCondition = () => {
    onChange({ ...group, children: [...group.children, { ...EMPTY_CONDITION }] });
  };

  const addGroup = () => {
    onChange({
      ...group,
      children: [
        ...group.children,
        { kind: "group", operator: "AND", children: [{ ...EMPTY_CONDITION }] },
      ],
    });
  };

  const setOperator = (op: GroupOperator) => onChange({ ...group, operator: op });

  const canNest = depth + 1 < MAX_GROUP_DEPTH;
  const operatorLabel = group.operator === "AND" ? "All of these must be true" : "Any of these must be true";

  return (
    <div
      className={
        isRoot
          ? "space-y-2"
          : "rounded-md border border-dashed border-border bg-muted/20 p-3 space-y-2"
      }
    >
      {/* Group header */}
      <div className="flex flex-wrap items-center gap-2">
        {!isRoot && <FolderTree className="h-4 w-4 text-muted-foreground" />}
        <Select value={group.operator} onValueChange={(v) => setOperator(v as GroupOperator)}>
          <SelectTrigger className="h-8 w-[230px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">All of these must be true (AND)</SelectItem>
            <SelectItem value="OR">Any of these must be true (OR)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">{operatorLabel}</span>

        {!isRoot && onRemove && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Remove group"
            className="ml-auto h-7 w-7 text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-2">
        {group.children.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-1">
            Empty group — add at least one condition.
          </p>
        )}
        {group.children.map((child, i) => {
          const connector = i > 0 ? group.operator : null;
          return (
            <div key={i} className="space-y-2">
              {connector && (
                <div className="flex items-center gap-2 px-1">
                  <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-primary">
                    {connector}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {isGroup(child) ? (
                <ConditionGroupBlock
                  group={child}
                  depth={depth + 1}
                  onChange={(next) => updateChild(i, next)}
                  onRemove={() => removeChild(i)}
                />
              ) : (
                <ConditionRow
                  condition={child}
                  index={i}
                  onChange={(next) => updateChild(i, next)}
                  onRemove={() => removeChild(i)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Add controls */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={addCondition}>
          <Plus className="h-4 w-4" />
          Add condition
        </Button>
        {canNest && (
          <Button variant="outline" size="sm" onClick={addGroup}>
            <Plus className="h-4 w-4" />
            Add group
          </Button>
        )}
        {!canNest && (
          <span className="text-[11px] text-muted-foreground self-center">
            Max nesting depth reached
          </span>
        )}
      </div>
    </div>
  );
}
