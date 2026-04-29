import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTION_LABELS, type ActionType, type RuleAction } from "./types";

interface Props {
  action: RuleAction;
  onChange: (next: RuleAction) => void;
  onRemove: () => void;
  /** Inline errors keyed to fields inside this action. */
  errors?: {
    channel?: string;
    email?: string;
    subject?: string;
    target_margin?: string;
    /** Generic action-level error (e.g. unsupported type). */
    row?: string;
  };
}

const ACTION_OPTIONS: ActionType[] = [
  "block_checkout",
  "slack_approval",
  "email_notify",
  "price_correction",
  "log_only",
];

export function ActionRow({ action, onChange, onRemove, errors }: Props) {
  const handleTypeChange = (next: ActionType) => {
    // Reset params when switching type.
    onChange({ type: next, params: {} });
  };

  const hasError = Boolean(
    errors?.channel || errors?.email || errors?.subject || errors?.target_margin || errors?.row,
  );

  return (
    <div
      className={
        "rounded-md border bg-card p-3 " +
        (hasError ? "border-destructive/60" : "border-border")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={action.type} onValueChange={(v) => handleTypeChange(v as ActionType)}>
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {ACTION_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {action.type === "slack_approval" && (
          <Input
            value={action.params?.channel ?? ""}
            onChange={(e) => onChange({ ...action, params: { ...action.params, channel: e.target.value } })}
            placeholder="#buying-team"
            className={"w-48 " + (errors?.channel ? "border-destructive" : "")}
            aria-label="Slack channel"
            aria-invalid={Boolean(errors?.channel)}
          />
        )}

        {action.type === "email_notify" && (
          <>
            <Input
              type="email"
              value={action.params?.email ?? ""}
              onChange={(e) => onChange({ ...action, params: { ...action.params, email: e.target.value } })}
              placeholder="manager@example.com"
              className={"w-64 " + (errors?.email ? "border-destructive" : "")}
              aria-label="Recipient email"
              aria-invalid={Boolean(errors?.email)}
            />
            <Input
              value={action.params?.subject ?? ""}
              onChange={(e) => onChange({ ...action, params: { ...action.params, subject: e.target.value } })}
              placeholder="Subject (optional)"
              className={"w-56 " + (errors?.subject ? "border-destructive" : "")}
              aria-label="Email subject"
              aria-invalid={Boolean(errors?.subject)}
            />
          </>
        )}

        {action.type === "price_correction" && (
          <>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={action.params?.target_margin ?? 40}
                onChange={(e) =>
                  onChange({ ...action, params: { ...action.params, target_margin: Number(e.target.value) } })
                }
                className={"w-20 " + (errors?.target_margin ? "border-destructive" : "")}
                aria-label="Target margin %"
                aria-invalid={Boolean(errors?.target_margin)}
              />
              <span className="text-xs text-muted-foreground">% target</span>
            </div>
            <Badge variant="outline" className="text-warning border-warning/50">
              Requires confirmation
            </Badge>
          </>
        )}

        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove action" className="ml-auto">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {hasError && (
        <div className="mt-1.5 space-y-0.5 pl-1">
          {errors?.channel && (
            <p className="text-xs text-destructive">
              {errors.channel}
              {action.type === "slack_approval" && !action.params?.channel
                ? " — must start with # or @"
                : ""}
            </p>
          )}
          {errors?.email && <p className="text-xs text-destructive">{errors.email}</p>}
          {errors?.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
          {errors?.target_margin && <p className="text-xs text-destructive">{errors.target_margin}</p>}
          {errors?.row && <p className="text-xs text-destructive">{errors.row}</p>}
        </div>
      )}
    </div>
  );
}
