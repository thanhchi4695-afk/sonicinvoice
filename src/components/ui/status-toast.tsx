import { Zap, Check, Loader2 } from "lucide-react";

interface StatusStepProps {
  steps: { label: string; status: "done" | "active" | "pending" }[];
}

/** Inline step indicator for multi-phase processing */
const StatusSteps = ({ steps }: StatusStepProps) => (
  <div className="space-y-1.5">
    {steps.map((s, i) => (
      <div key={i} className="flex items-center gap-2 text-xs">
        {s.status === "done" && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
        {s.status === "active" && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
        {s.status === "pending" && <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 shrink-0" />}
        <span className={s.status === "active" ? "text-foreground font-medium" : s.status === "done" ? "text-muted-foreground" : "text-muted-foreground/60"}>
          {s.label}
        </span>
      </div>
    ))}
  </div>
);

/** Small inline processing indicator */
const ProcessingPill = ({ label }: { label: string }) => (
  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium text-primary animate-pulse">
    <Zap className="w-3 h-3" fill="currentColor" />
    {label}
  </div>
);

export { StatusSteps, ProcessingPill };
