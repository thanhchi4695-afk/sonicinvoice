// Post-parse summary dialog. Shows the user which AI agents are about to run
// (or just ran), in which mode, and a quick confidence read + reason — so they
// can review and continue, or skip, before anything else fires.

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Check, X, ShieldCheck, Sparkles, Tag, Send, GraduationCap } from "lucide-react";
import { AUTO_AGENT_LABELS, type AutoAgentId, type AgentMode } from "@/lib/auto-agents-settings";

export interface AgentRunPlan {
  id: AutoAgentId;
  mode: AgentMode;
  confidence: number; // 0–1
  reason: string;
}

const AGENT_ICONS: Record<AutoAgentId, typeof Bot> = {
  classifier: Tag,
  enrichment: Sparkles,
  watchdog: ShieldCheck,
  publishing: Send,
  learning: GraduationCap,
};

function confTone(c: number): { label: string; cls: string } {
  if (c >= 0.9) return { label: "High", cls: "bg-success/15 text-success border-success/30" };
  if (c >= 0.7) return { label: "Medium", cls: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Low", cls: "bg-destructive/15 text-destructive border-destructive/30" };
}

interface Props {
  open: boolean;
  plan: AgentRunPlan[];
  supplier?: string;
  productCount?: number;
  onConfirm: () => void;
  onSkip: () => void;
}

export default function AutoAgentsRunSummary({ open, plan, supplier, productCount, onConfirm, onSkip }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onSkip(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI agents ready to run
          </DialogTitle>
          <DialogDescription>
            {productCount != null ? `${productCount} line${productCount === 1 ? "" : "s"} parsed` : "Invoice parsed"}
            {supplier ? ` from ${supplier}` : ""}. Review what runs next.
          </DialogDescription>
        </DialogHeader>

        {plan.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No agents enabled. You can turn them on in AI Agents → Settings.
          </div>
        ) : (
          <ul className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {plan.map((p) => {
              const meta = AUTO_AGENT_LABELS[p.id];
              const Icon = AGENT_ICONS[p.id];
              const tone = confTone(p.confidence);
              const modeLabel = meta.hasMode
                ? meta.modeLabels?.[p.mode] ?? p.mode
                : "—";
              return (
                <li key={p.id} className="rounded-lg border border-border bg-card p-3 flex gap-3">
                  <div className="mt-0.5">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{meta.name}</span>
                      {meta.hasMode && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{modeLabel}</Badge>
                      )}
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tone.cls}`}>
                        {tone.label} · {Math.round(p.confidence * 100)}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{p.reason}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onSkip}>
            <X className="w-4 h-4 mr-1" /> Skip
          </Button>
          <Button onClick={onConfirm} disabled={plan.length === 0}>
            <Check className="w-4 h-4 mr-1" /> Run agents
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Build a heuristic plan from the current settings + parse result. Pure —
 * no side effects — so it's easy to preview in tests/storybook.
 */
export function buildAgentPlan(
  enabled: AutoAgentId[],
  modes: Record<AutoAgentId, AgentMode>,
  ctx: { productCount: number; supplierKnown: boolean; avgQuality?: number },
): AgentRunPlan[] {
  const baseQuality = Math.max(0.55, Math.min(1, ctx.avgQuality ?? 0.9));
  return enabled.map<AgentRunPlan>((id) => {
    const mode = modes[id];
    switch (id) {
      case "classifier":
        return {
          id, mode,
          confidence: mode === "strict" ? Math.min(0.99, baseQuality) : Math.min(0.95, baseQuality - 0.05),
          reason: mode === "strict"
            ? "Apply category, fabric and audience tags only when ≥90% confident."
            : "Tag everything; low-confidence tags get flagged for review.",
        };
      case "enrichment":
        return {
          id, mode,
          confidence: mode === "strict" ? 0.92 : 0.84,
          reason: mode === "strict"
            ? "Keep supplier titles unless clearly weak. Fill in missing descriptions."
            : "Rewrite to [Color] + [Feature] + [Type] and draft fresh descriptions.",
        };
      case "watchdog":
        return {
          id, mode,
          confidence: mode === "strict" ? 0.98 : 0.9,
          reason: mode === "strict"
            ? "Block any line below target margin. Hard stop before publish."
            : "Warn within 5% of target margin; allow through.",
        };
      case "publishing":
        return {
          id, mode,
          confidence: mode === "strict" ? Math.min(0.95, baseQuality) : Math.min(0.85, baseQuality - 0.05),
          reason: mode === "strict"
            ? "Only push lines at ≥90% supplier confidence with Watchdog clearance."
            : "Push lines at ≥70% confidence — faster, may need fixes.",
          };
      case "learning":
        return {
          id, mode,
          confidence: ctx.supplierKnown ? 0.95 : 0.8,
          reason: ctx.supplierKnown
            ? "Update the supplier brain with any corrections from this invoice."
            : "First time seeing this supplier — seed a fresh brain entry.",
        };
    }
  });
}
