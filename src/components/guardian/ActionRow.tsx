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
}

const ACTION_OPTIONS: ActionType[] = [
  "block_checkout",
  "slack_approval",
  "email_notify",
  "price_correction",
  "log_only",
];

export function ActionRow({ action, onChange, onRemove }: Props) {
  const handleTypeChange = (next: ActionType) => {
    // Reset params when switching type.
    onChange({ type: next, params: {} });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
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
          className="w-48"
          aria-label="Slack channel"
        />
      )}

      {action.type === "email_notify" && (
        <>
          <Input
            type="email"
            value={action.params?.email ?? ""}
            onChange={(e) => onChange({ ...action, params: { ...action.params, email: e.target.value } })}
            placeholder="manager@example.com"
            className="w-64"
            aria-label="Recipient email"
          />
          <Input
            value={action.params?.subject ?? ""}
            onChange={(e) => onChange({ ...action, params: { ...action.params, subject: e.target.value } })}
            placeholder="Subject (optional)"
            className="w-56"
            aria-label="Email subject"
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
              className="w-20"
              aria-label="Target margin %"
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
  );
}
