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
}

/**
 * Compact inline reason picker shown directly under an edited cell.
 * Ambient pill-style buttons; no modal/popup.
 */
export default function CorrectionReasonPicker({ onPick, onDismiss }: Props) {
  const [otherDetail, setOtherDetail] = useState("");
  const [showOther, setShowOther] = useState(false);

  if (showOther) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
        <Input
          autoFocus
          value={otherDetail}
          onChange={(e) => setOtherDetail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && otherDetail.trim()) {
              onPick("other", otherDetail.trim());
            } else if (e.key === "Escape") {
              onDismiss();
            }
          }}
          placeholder="Why was this wrong?"
          className="h-6 text-[10px] flex-1 min-w-0"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-[10px]"
          onClick={() => onPick("other", otherDetail.trim() || undefined)}
        >
          Save
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
      <span className="text-[9px] text-muted-foreground mr-0.5">Why?</span>
      {REASONS.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => {
            if (r.key === "other") setShowOther(true);
            else onPick(r.key);
          }}
          className="px-1.5 py-0.5 text-[10px] rounded-full bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-transparent hover:border-border"
        >
          {r.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 text-[9px] text-muted-foreground/60 hover:text-muted-foreground"
        title="Skip"
      >
        skip
      </button>
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
