// Validation flag UI for Brain Mode review:
//   • <BrainSummaryBanner> shown above the products table when any flags exist.
//   • <BrainFlagBadges> shown next to each row's title with per-flag dismiss.
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { BrainFlag, BrainProduct, BrainValidationSummary } from "@/lib/brain-validator";
import { visibleFlags } from "@/lib/brain-validator";

const CODE_LABELS: Record<string, string> = {
  cost_exceeds_rrp: "Cost ≥ RRP",
  low_margin: "Low margin",
  high_margin: "High margin",
  missing_name: "Missing name",
  missing_rrp: "Missing RRP",
  missing_cost: "Missing cost",
  zero_qty: "Zero qty",
  duplicate_style: "Duplicate style",
  fractional_qty: "Fractional qty",
  large_order: "Large order",
};

export function BrainSummaryBanner({ summary }: { summary: BrainValidationSummary }) {
  if (!summary?.flagged) return null;
  const parts = Object.entries(summary.byCode)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n} ${CODE_LABELS[code] || code}`);
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 mb-3 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
      <div className="text-xs">
        <p className="font-semibold text-warning">
          {summary.flagged} of {summary.total} product group{summary.total === 1 ? "" : "s"} need review
        </p>
        <p className="text-muted-foreground mt-0.5">{parts.join(" · ")}</p>
      </div>
    </div>
  );
}

export function BrainFlagBadges({
  product, onDismiss,
}: {
  product: BrainProduct;
  onDismiss: (code: string) => void;
}) {
  const flags = visibleFlags(product);
  if (!flags.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {flags.map(f => (
        <FlagPill key={f.code} flag={f} onDismiss={() => onDismiss(f.code)} />
      ))}
    </div>
  );
}

function FlagPill({ flag, onDismiss }: { flag: BrainFlag; onDismiss: () => void }) {
  const [hover, setHover] = useState(false);
  const cls = flag.severity === "error"
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : flag.severity === "warn"
      ? "bg-warning/15 text-warning border-warning/30"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={flag.message}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      <AlertTriangle className="w-3 h-3" />
      {CODE_LABELS[flag.code] || flag.code}
      <button
        onClick={onDismiss}
        aria-label={`Dismiss ${flag.code}`}
        className={`ml-0.5 rounded-full hover:bg-foreground/10 ${hover ? "opacity-100" : "opacity-60"}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export function BrainRecognitionBanner({ supplierName }: { supplierName: string }) {
  if (!supplierName) return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 mb-3 flex items-center gap-2">
      <span className="text-sm">🧠</span>
      <p className="text-xs text-primary font-medium">
        Recognised <span className="font-semibold">{supplierName}</span> invoice — using saved template.
        Review for accuracy.
      </p>
    </div>
  );
}
