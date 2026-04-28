// ════════════════════════════════════════════════════════════════
// LinePipelineProgress — interactive step-by-step visual that
// mirrors the 4 enrichment sub-agents (Query Builder → Supplier
// Agent → Web Agent → Verifier) for a single invoice line.
// ════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Search, Building2, Globe2, ShieldCheck, Check, Loader2, AlertTriangle, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type StageStatus = "pending" | "active" | "done" | "skipped" | "failed";
export type StageKey = "query" | "supplier" | "web" | "verifier";

export interface PipelineStage {
  key: StageKey;
  status: StageStatus;
  detail?: string;          // e.g. "Brand + Name + Colour"
  candidates?: number;      // how many results found at this stage
  confidence?: number;      // verifier confidence
}

interface Props {
  stages: PipelineStage[];
  compact?: boolean;
}

const META: Record<StageKey, { label: string; icon: typeof Search; accent: string }> = {
  query:    { label: "Query Builder",  icon: Search,       accent: "text-accent" },
  supplier: { label: "Supplier Agent", icon: Building2,    accent: "text-primary" },
  web:      { label: "Web Agent",      icon: Globe2,       accent: "text-purple-500" },
  verifier: { label: "Verifier",       icon: ShieldCheck,  accent: "text-success" },
};

const ORDER: StageKey[] = ["query", "supplier", "web", "verifier"];

const LinePipelineProgress = ({ stages, compact = true }: Props) => {
  const [expanded, setExpanded] = useState(!compact);

  // Build lookup, ensuring all 4 stages are represented
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const fullStages: PipelineStage[] = ORDER.map(
    (k) => byKey.get(k) ?? { key: k, status: "pending" as StageStatus }
  );

  const activeIdx = fullStages.findIndex((s) => s.status === "active");
  const doneCount = fullStages.filter((s) => s.status === "done").length;

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      {/* ── Step rail ─────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        {fullStages.map((stage, i) => {
          const meta = META[stage.key];
          const Icon = meta.icon;
          const isActive = stage.status === "active";
          const isDone = stage.status === "done";
          const isFailed = stage.status === "failed";
          const isSkipped = stage.status === "skipped";

          return (
            <div key={stage.key} className="flex flex-1 items-center gap-1 min-w-0">
              {/* Step bubble */}
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border transition-all",
                    isDone && "border-success bg-success/10 text-success",
                    isActive && "border-primary bg-primary/10 text-primary animate-pulse",
                    isFailed && "border-destructive bg-destructive/10 text-destructive",
                    isSkipped && "border-border bg-muted text-muted-foreground/50",
                    stage.status === "pending" && "border-border bg-card text-muted-foreground/60"
                  )}
                  title={meta.label}
                >
                  {isDone && <Check className="h-3.5 w-3.5" />}
                  {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isFailed && <AlertTriangle className="h-3.5 w-3.5" />}
                  {(isSkipped || stage.status === "pending") && <Icon className="h-3.5 w-3.5" />}
                </div>
                <span
                  className={cn(
                    "truncate text-[9px] font-medium leading-tight",
                    isActive ? "text-primary" : isDone ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {meta.label.split(" ")[0]}
                </span>
              </div>

              {/* Connector */}
              {i < fullStages.length - 1 && (
                <div
                  className={cn(
                    "mb-4 h-0.5 flex-1 rounded-full transition-colors",
                    i < doneCount - (isActive ? 0 : 0) && fullStages[i].status === "done"
                      ? "bg-success/50"
                      : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}

        {/* Toggle details */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-1 self-start rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* ── Active step caption ──────────────────────────── */}
      {activeIdx >= 0 && fullStages[activeIdx].detail && (
        <p className="mt-1 text-[10px] text-primary">
          <span className="font-semibold">{META[fullStages[activeIdx].key].label}:</span>{" "}
          {fullStages[activeIdx].detail}
        </p>
      )}

      {/* ── Expanded per-stage details ───────────────────── */}
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-border/60 pt-2 animate-fade-in">
          {fullStages.map((stage) => {
            const meta = META[stage.key];
            const Icon = meta.icon;
            return (
              <li key={stage.key} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-foreground">
                  <Icon className={cn("h-3 w-3", meta.accent)} />
                  <span className="font-medium">{meta.label}</span>
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {stage.detail && <span className="truncate max-w-[180px]">{stage.detail}</span>}
                  {typeof stage.candidates === "number" && (
                    <span className="font-mono-data">{stage.candidates} hits</span>
                  )}
                  {typeof stage.confidence === "number" && stage.key === "verifier" && (
                    <span
                      className={cn(
                        "font-mono-data",
                        stage.confidence >= 90 ? "text-success" : stage.confidence >= 70 ? "text-secondary" : "text-destructive"
                      )}
                    >
                      {stage.confidence}%
                    </span>
                  )}
                  <StatusPill status={stage.status} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const StatusPill = ({ status }: { status: StageStatus }) => {
  const map: Record<StageStatus, { label: string; cls: string }> = {
    pending: { label: "waiting", cls: "bg-muted text-muted-foreground" },
    active:  { label: "running", cls: "bg-primary/15 text-primary" },
    done:    { label: "done",    cls: "bg-success/15 text-success" },
    skipped: { label: "skipped", cls: "bg-muted text-muted-foreground/70" },
    failed:  { label: "failed",  cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", m.cls)}>
      {status === "pending" && <Circle className="h-2 w-2" />}
      {m.label}
    </span>
  );
};

export default LinePipelineProgress;
