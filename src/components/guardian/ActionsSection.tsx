import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ACTION_LABELS,
  type ActionType,
  type RuleAction,
} from "./types";

/**
 * Checkbox-driven Actions section.
 *
 * Each supported action is a checkbox. Checking it appends a `RuleAction`
 * to `actions`; unchecking removes it (and discards its params). When checked,
 * its parameter inputs render inline beneath the checkbox.
 *
 * State shape stays simple: `actions: { type, params: { ... } }[]`.
 */

interface Props {
  actions: RuleAction[];
  onChange: (next: RuleAction[]) => void;
  /** Lookup inline error message by validation key. */
  errorAt: (key: string) => string | undefined;
  /** Generic actions-array error (e.g. "at least one action"). */
  actionsError?: string;
}

const ACTION_ORDER: ActionType[] = [
  "block_checkout",
  "slack_approval",
  "price_correction",
  "email_notify",
  "log_only",
];

export function ActionsSection({ actions, onChange, errorAt, actionsError }: Props) {
  const indexOf = (type: ActionType) => actions.findIndex((a) => a.type === type);
  const isChecked = (type: ActionType) => indexOf(type) !== -1;
  const getAction = (type: ActionType): RuleAction | undefined => actions[indexOf(type)];

  const toggle = (type: ActionType, checked: boolean) => {
    if (checked) {
      if (isChecked(type)) return;
      onChange([...actions, { type, params: {} }]);
    } else {
      onChange(actions.filter((a) => a.type !== type));
    }
  };

  const updateParams = (type: ActionType, patch: Partial<NonNullable<RuleAction["params"]>>) => {
    const i = indexOf(type);
    if (i === -1) return;
    const copy = [...actions];
    copy[i] = { ...copy[i], params: { ...copy[i].params, ...patch } };
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      {ACTION_ORDER.map((type) => {
        const checked = isChecked(type);
        const action = getAction(type);
        const i = indexOf(type);
        // Errors are keyed by array index in the persisted rule.
        const channelErr = i !== -1 ? errorAt(`action:${i}:channel`) : undefined;
        const emailErr = i !== -1 ? errorAt(`action:${i}:email`) : undefined;
        const subjectErr = i !== -1 ? errorAt(`action:${i}:subject`) : undefined;
        const marginErr = i !== -1 ? errorAt(`action:${i}:target_margin`) : undefined;
        const rowErr =
          i !== -1 && !channelErr && !emailErr && !marginErr
            ? errorAt(`action:${i}`)
            : undefined;

        const hasError = Boolean(channelErr || emailErr || subjectErr || marginErr || rowErr);

        return (
          <div
            key={type}
            className={
              "rounded-md border bg-card p-3 transition-colors " +
              (hasError ? "border-destructive/60" : "border-border")
            }
          >
            <div className="flex items-start gap-2">
              <Checkbox
                id={`action-${type}`}
                checked={checked}
                onCheckedChange={(v) => toggle(type, Boolean(v))}
                className="mt-0.5"
              />
              <Label htmlFor={`action-${type}`} className="cursor-pointer text-sm font-normal">
                {ACTION_LABELS[type]}
              </Label>
              {type === "price_correction" && checked && (
                <Badge variant="outline" className="ml-2 text-warning border-warning/50">
                  Requires confirmation
                </Badge>
              )}
            </div>

            {checked && type === "slack_approval" && (
              <div className="mt-3 pl-6">
                <Label htmlFor="slack-channel" className="text-xs text-muted-foreground">
                  Channel name
                </Label>
                <Input
                  id="slack-channel"
                  value={action?.params?.channel ?? ""}
                  onChange={(e) => updateParams(type, { channel: e.target.value })}
                  placeholder="#buying-team or @username"
                  className={"mt-1 max-w-xs " + (channelErr ? "border-destructive" : "")}
                  aria-invalid={Boolean(channelErr)}
                />
                {channelErr && (
                  <p className="mt-1 text-xs text-destructive">{channelErr}</p>
                )}
              </div>
            )}

            {checked && type === "price_correction" && (
              <div className="mt-3 pl-6">
                <Label htmlFor="target-margin" className="text-xs text-muted-foreground">
                  Target margin %
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="target-margin"
                    type="number"
                    min={0}
                    max={100}
                    value={action?.params?.target_margin ?? ""}
                    onChange={(e) =>
                      updateParams(type, {
                        target_margin: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="40"
                    className={"w-24 " + (marginErr ? "border-destructive" : "")}
                    aria-invalid={Boolean(marginErr)}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                {marginErr && (
                  <p className="mt-1 text-xs text-destructive">{marginErr}</p>
                )}
              </div>
            )}

            {checked && type === "email_notify" && (
              <div className="mt-3 space-y-2 pl-6">
                <div>
                  <Label htmlFor="notify-email" className="text-xs text-muted-foreground">
                    Email address
                  </Label>
                  <Input
                    id="notify-email"
                    type="email"
                    value={action?.params?.email ?? ""}
                    onChange={(e) => updateParams(type, { email: e.target.value })}
                    placeholder="manager@example.com"
                    className={"mt-1 max-w-sm " + (emailErr ? "border-destructive" : "")}
                    aria-invalid={Boolean(emailErr)}
                  />
                  {emailErr && (
                    <p className="mt-1 text-xs text-destructive">{emailErr}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="notify-subject" className="text-xs text-muted-foreground">
                    Subject (optional)
                  </Label>
                  <Input
                    id="notify-subject"
                    value={action?.params?.subject ?? ""}
                    onChange={(e) => updateParams(type, { subject: e.target.value })}
                    placeholder="Margin alert: PO requires review"
                    className={"mt-1 max-w-sm " + (subjectErr ? "border-destructive" : "")}
                    aria-invalid={Boolean(subjectErr)}
                  />
                  {subjectErr && (
                    <p className="mt-1 text-xs text-destructive">{subjectErr}</p>
                  )}
                </div>
              </div>
            )}

            {rowErr && (
              <p className="mt-2 pl-6 text-xs text-destructive">{rowErr}</p>
            )}
          </div>
        );
      })}

      {actionsError && (
        <p className="text-xs text-destructive">{actionsError}</p>
      )}
    </div>
  );
}
