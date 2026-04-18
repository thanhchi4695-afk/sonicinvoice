import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CorrectionReason } from "@/lib/correction-tracker";

interface ReasonOption {
  key: CorrectionReason;
  label: string;
}

const REASONS: ReasonOption[] = [
  { key: "wrong_column_detected", label: "Wrong column" },
  { key: "wrong_format", label: "Wrong format" },
  { key: "currency_error", label: "Currency" },
  { key: "size_system_wrong", label: "Wrong size system" },
  { key: "missed_field", label: "Field missing" },
  { key: "other", label: "Other" },
];

interface Props {
  onPick: (reason: CorrectionReason, detail?: string) => void;
  onDismiss: () => void;
  /** Optional summary of which fields will be tagged with this reason. */
  summary?: string;
}

/**
 * Inline reason picker bar. Used at the row level after "Done editing"
 * to capture a single reason that applies to every changed field in the row.
 *
 * Styling: dark surface with light text; selected pill flashes teal.
 */
export default function CorrectionReasonPicker({ onPick, onDismiss, summary }: Props) {
  const [otherDetail, setOtherDetail] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [selected, setSelected] = useState<CorrectionReason | null>(null);

  const handlePick = (reason: CorrectionReason, detail?: string) => {
    setSelected(reason);
    // Allow the teal flash to render briefly before the parent dismisses us.
    window.setTimeout(() => onPick(reason, detail), 120);
  };

  if (showOther) {
    return (
      <div className="flex items-center gap-1.5 mt-2 p-2 rounded-md bg-muted/40 border border-border animate-in fade-in slide-in-from-top-1 duration-150">
        <Input
          autoFocus
          value={otherDetail}
          onChange={(e) => setOtherDetail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && otherDetail.trim()) handlePick("other", otherDetail.trim());
            else if (e.key === "Escape") onDismiss();
          }}
          placeholder="Why was this wrong?"
          className="h-7 text-xs flex-1 min-w-0"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => handlePick("other", otherDetail.trim() || undefined)}
        >
          Save
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 p-2 rounded-md bg-muted/40 border border-border animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Why was this wrong?
        </span>
        {summary && (
          <span className="text-[10px] text-muted-foreground/80 truncate">· {summary}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {REASONS.map((r) => {
          const isActive = selected === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                if (r.key === "other") setShowOther(true);
                else handlePick(r.key);
              }}
              className={[
                "px-2.5 py-1 text-[11px] rounded-full border transition-colors",
                isActive
                  ? "bg-success/20 border-success/60 text-success"
                  : "bg-background/60 border-border text-foreground hover:bg-background hover:border-foreground/30",
              ].join(" ")}
            >
              {r.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto px-2 py-1 text-[10px] text-muted-foreground/70 hover:text-muted-foreground"
          title="Skip — record as unspecified"
        >
          skip
        </button>
      </div>
    </div>
  );
}

/** Subtle confirmation flash shown for ~1.5s after a reason is recorded. */
export function CorrectionSavedCheck() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-success mt-1 animate-in fade-in duration-150">
      <Check className="w-3 h-3" />
      Recorded
    </span>
  );
}

