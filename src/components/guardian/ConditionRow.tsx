import { Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FIELD_LABELS,
  NUMBER_OPERATORS,
  SURFACE_OPTIONS,
  TEXT_OPERATORS,
  isNumberField,
  operatorsForField,
  type ConditionField,
  type ConditionOperator,
  type RuleCondition,
} from "./types";

interface Props {
  condition: RuleCondition;
  onChange: (next: RuleCondition) => void;
  onRemove: () => void;
  index: number;
  /** Inline error keyed to the value cell, e.g. "Value required". */
  valueError?: string;
  /** Inline error keyed to the operator cell. */
  operatorError?: string;
  /** Generic row-level error (e.g. field/operator mismatch from refinements). */
  rowError?: string;
}

const FIELD_OPTIONS: ConditionField[] = [
  "brand",
  "vendor",
  "sku",
  "product_category",
  "margin_pct",
  "po_total",
  "quantity",
  "surface",
];

export function ConditionRow({ condition, onChange, onRemove, index, valueError, operatorError, rowError }: Props) {
  const handleFieldChange = (next: ConditionField) => {
    // Reset operator + value when switching field family.
    const ops = isNumberField(next) ? NUMBER_OPERATORS : TEXT_OPERATORS;
    onChange({ field: next, operator: ops[0].value as ConditionOperator, value: isNumberField(next) ? 0 : "" });
  };

  const handleOperatorChange = (next: ConditionOperator) => {
    let value: RuleCondition["value"] = condition.value;
    if (next === "is_between" && !Array.isArray(value)) value = [0, 0];
    if (next !== "is_between" && Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
      value = (value[0] as number) ?? 0;
    }
    onChange({ ...condition, operator: next, value });
  };

  const renderValueInput = () => {
    if (condition.operator === "is_between") {
      const [a, b] = (Array.isArray(condition.value) ? condition.value : [0, 0]) as [number, number];
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={a}
            onChange={(e) => onChange({ ...condition, value: [Number(e.target.value), b] as [number, number] })}
            className="w-24"
            aria-label="Min value"
          />
          <span className="text-muted-foreground text-xs">and</span>
          <Input
            type="number"
            value={b}
            onChange={(e) => onChange({ ...condition, value: [a, Number(e.target.value)] as [number, number] })}
            className="w-24"
            aria-label="Max value"
          />
        </div>
      );
    }

    if (condition.operator === "in" || condition.operator === "not_in") {
      const csv = Array.isArray(condition.value) ? (condition.value as (string | number)[]).join(", ") : "";
      return (
        <Input
          value={csv}
          onChange={(e) =>
            onChange({
              ...condition,
              value: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="value1, value2, value3"
          className="w-64"
        />
      );
    }

    if (condition.field === "surface") {
      return (
        <Select value={String(condition.value)} onValueChange={(v) => onChange({ ...condition, value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select surface" />
          </SelectTrigger>
          <SelectContent>
            {SURFACE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (isNumberField(condition.field)) {
      return (
        <Input
          type="number"
          value={typeof condition.value === "number" ? condition.value : 0}
          onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
          className="w-32"
        />
      );
    }

    return (
      <Input
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="Enter value"
        className="w-64"
      />
    );
  };

  const hasError = Boolean(valueError || operatorError || rowError);
  return (
    <div
      className={
        "rounded-md border bg-card p-3 " +
        (hasError ? "border-destructive/60" : "border-border")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {index > 0 && <span className="text-xs font-medium text-muted-foreground">AND</span>}

        <Select value={condition.field} onValueChange={(v) => handleFieldChange(v as ConditionField)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_OPTIONS.map((f) => (
              <SelectItem key={f} value={f}>
                {FIELD_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-col">
          <Select
            value={condition.operator}
            onValueChange={(v) => handleOperatorChange(v as ConditionOperator)}
          >
            <SelectTrigger
              className={"w-40 " + (operatorError ? "border-destructive" : "")}
              aria-invalid={Boolean(operatorError)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorsForField(condition.field).map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col">
          <div className={valueError ? "[&_input]:border-destructive [&_button]:border-destructive" : ""}>
            {renderValueInput()}
          </div>
        </div>

        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove condition" className="ml-auto">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {(valueError || operatorError || rowError) && (
        <div className="mt-1.5 space-y-0.5 pl-1">
          {operatorError && <p className="text-xs text-destructive">{operatorError}</p>}
          {valueError && <p className="text-xs text-destructive">{valueError}</p>}
          {rowError && <p className="text-xs text-destructive">{rowError}</p>}
        </div>
      )}
    </div>
  );
}
