import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, ShieldAlert } from "lucide-react";

export interface GraderResult {
  passed: boolean;
  score: number;
  criteria: Record<string, "pass" | "fail" | "unverified">;
  failures: string[];
  reextract_needed: boolean;
  reextract_reason: string;
  attempts?: number;
  error?: string;
}

interface Props {
  result: GraderResult | null | undefined;
}

/**
 * Sonic Outcomes Grader badge — shown on the Review screen so staff can
 * see at a glance whether the extraction passed the quality rubric.
 *
 * 🟢 ≥90 — all criteria passed
 * 🟡 70–89 — some criteria flagged, reviewed and passed
 * 🔴 <70 — re-extraction triggered, manual review needed
 */
export default function GraderBadge({ result }: Props) {
  const [open, setOpen] = useState(false);
  if (!result) return null;

  const score = Math.max(0, Math.min(100, Math.round(result.score)));
  const tier =
    score >= 90 ? "good" : score >= 70 ? "warn" : "bad";

  const tierStyles = {
    good: "bg-success/15 text-success border-success/30",
    warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    bad:  "bg-destructive/15 text-destructive border-destructive/30",
  }[tier];

  const Icon = tier === "good" ? ShieldCheck : tier === "warn" ? AlertTriangle : ShieldAlert;
  const dot = tier === "good" ? "🟢" : tier === "warn" ? "🟡" : "🔴";

  const criteriaEntries = Object.entries(result.criteria || {});
  const failedCount = criteriaEntries.filter(([, v]) => v === "fail").length;
  const unverifiedCount = criteriaEntries.filter(([, v]) => v === "unverified").length;

  const summary =
    tier === "good"
      ? "all criteria passed"
      : tier === "warn"
      ? `${failedCount} criteria flagged, reviewed and passed`
      : result.reextract_needed
      ? "re-extraction triggered, manual review needed"
      : `${failedCount} criteria failed — manual review needed`;

  return (
    <div className={`mt-3 rounded-lg border ${tierStyles}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm"
      >
        <span className="flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4" />
          <span>
            {dot} Score: {score}/100 — {summary}
          </span>
          {(result.attempts ?? 0) > 1 && (
            <span className="text-xs opacity-75">· attempts: {result.attempts}</span>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-current/20 p-3 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {criteriaEntries.map(([k, v]) => {
              const mark = v === "pass" ? "✓" : v === "unverified" ? "?" : "✗";
              const cls =
                v === "pass" ? "text-success"
                : v === "unverified" ? "text-muted-foreground"
                : "text-destructive";
              return (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{k}</span>
                  <span className={`font-mono ${cls}`}>{mark} {v}</span>
                </div>
              );
            })}
          </div>

          {unverifiedCount > 0 && (
            <p className="opacity-75">
              {unverifiedCount} criterion {unverifiedCount === 1 ? "is" : "are"} unverified (e.g. invoice subtotal not detected).
            </p>
          )}

          {result.failures?.length > 0 && (
            <div>
              <div className="font-semibold mb-1">Failures</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {result.failures.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {result.reextract_needed && result.reextract_reason && (
            <div>
              <div className="font-semibold mb-1">Re-extract instruction</div>
              <p className="opacity-90">{result.reextract_reason}</p>
            </div>
          )}

          {result.error && (
            <p className="opacity-75">Grader error: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
