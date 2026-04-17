import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Displays per-field AI confidence indicators above the invoice review table.
 *
 * Design philosophy: calm by default — only surface uncertainty. High-confidence
 * fields (90+) get no indicator at all. Lower scores escalate from a subtle
 * amber dot → "Check" label → red dot + "Verify" label.
 */

/** AI returns these field keys (see parse-invoice edge function). */
export const AI_FIELDS: Record<string, string> = {
  product_name: "Title",
  sku: "SKU",
  colour: "Colour",
  size: "Size",
  quantity: "Qty",
  cost_ex_gst: "Cost",
  rrp_incl_gst: "RRP",
  vendor: "Vendor",
};

/** AI key → ValidatedProduct field name (used when tinting row cells). */
export const AI_TO_PRODUCT_FIELD: Record<string, string> = {
  product_name: "name",
  sku: "sku",
  colour: "colour",
  size: "size",
  quantity: "qty",
  cost_ex_gst: "cost",
  rrp_incl_gst: "rrp",
  vendor: "brand",
};

export type ConfidenceLevel = "high" | "warn" | "check" | "verify";

export function levelFor(score: number): ConfidenceLevel {
  if (score >= 90) return "high";
  if (score >= 70) return "warn";
  if (score >= 50) return "check";
  return "verify";
}

/** Returns the set of internal product field names with low confidence (< 70). */
export function lowConfidenceFieldNames(fc: Record<string, number> | null): Set<string> {
  const out = new Set<string>();
  if (!fc) return out;
  for (const [aiKey, score] of Object.entries(fc)) {
    if (typeof score === "number" && score < 70) {
      const f = AI_TO_PRODUCT_FIELD[aiKey];
      if (f) out.add(f);
    }
  }
  return out;
}

interface FieldConfidenceHeaderProps {
  fieldConfidence: Record<string, number> | null;
  extractionNotes?: string | null;
}

export default function FieldConfidenceHeader({
  fieldConfidence,
  extractionNotes,
}: FieldConfidenceHeaderProps) {
  const [bannerDismissed, setBannerDismissed] = useState(false);

  if (!fieldConfidence || Object.keys(fieldConfidence).length === 0) return null;

  const entries = Object.entries(AI_FIELDS)
    .map(([key, label]) => ({
      key,
      label,
      score: typeof fieldConfidence[key] === "number" ? fieldConfidence[key] : null,
    }))
    .filter(e => e.score !== null) as { key: string; label: string; score: number }[];

  const lowFields = entries.filter(e => e.score < 70);
  const showBanner = !bannerDismissed && lowFields.length > 0;

  // Hide entirely if everything is high-confidence.
  const anyToShow = entries.some(e => e.score < 90);
  if (!anyToShow && !showBanner) return null;

  return (
    <div className="mb-3 space-y-2">
      {showBanner && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-secondary">
              The AI is uncertain about{" "}
              {lowFields.map((f, i) => (
                <span key={f.key}>
                  <span className="font-semibold">{f.label.toLowerCase()}</span>
                  {i < lowFields.length - 2 ? ", " : i === lowFields.length - 2 ? " and " : ""}
                </span>
              ))}
              . Please review highlighted columns before exporting.
            </p>
            {extractionNotes && (
              <p className="mt-1 text-[10px] text-muted-foreground">{extractionNotes}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setBannerDismissed(true)}
            className="shrink-0 rounded p-0.5 text-secondary/70 hover:bg-secondary/20 hover:text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {anyToShow && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Column confidence:
          </span>
          <TooltipProvider delayDuration={200}>
            {entries
              .filter(e => e.score < 90) // calm by default — hide high-confidence
              .map(e => {
                const lvl = levelFor(e.score);
                const dotClass =
                  lvl === "verify"
                    ? "bg-destructive"
                    : "bg-secondary"; // amber
                const labelText =
                  lvl === "verify" ? "Verify" : lvl === "check" ? "Check" : null;
                const labelClass =
                  lvl === "verify" ? "text-destructive" : "text-muted-foreground";
                return (
                  <Tooltip key={e.key}>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex cursor-help items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                        tabIndex={0}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                        {e.label}
                        {labelText && (
                          <span className={`text-[9px] font-normal ${labelClass}`}>
                            {labelText}
                          </span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      <p className="text-[10px]">
                        AI confidence: <span className="font-semibold">{e.score}%</span>
                        {extractionNotes ? <span className="text-muted-foreground"> — {extractionNotes}</span> : null}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
