import { useState, useCallback, useMemo, useEffect } from "react";
import { ArrowLeft, Check, SkipForward, RotateCcw, AlertCircle, Clock, ChevronDown, ChevronUp, Loader2, Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getPipelineById } from "@/lib/pipeline-definitions";
import { supabase } from "@/integrations/supabase/client";
import { isBrainModeEnabled } from "@/lib/brain-pipeline";
import { toAgentStep } from "@/lib/agent-step-mapping";
import AgentChatPanel from "@/components/AgentChatPanel";
import {
  getPipelineContext,
  setPipelineContext,
  clearPipelineContext,
  createFreshContext,
  addPipelineLog,
  PipelineContext,
  StepExecutionStatus,
} from "@/lib/pipeline-context";

interface PipelineRunnerProps {
  pipelineId: string;
  onRenderFlow: (flowKey: string, onFlowComplete: () => void) => React.ReactNode;
  onExit: () => void;
}

const STATUS_ICON: Record<StepExecutionStatus, React.ReactNode> = {
  pending: <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0 inline-block" />,
  running: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />,
  success: <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />,
  failed: <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  skipped: <span className="text-muted-foreground shrink-0 text-xs">–</span>,
};

const STATUS_LABEL: Record<StepExecutionStatus, string> = {
  pending: "Pending",
  running: "Running…",
  success: "Complete",
  failed: "Failed",
  skipped: "Skipped",
};

const PipelineRunner = ({ pipelineId, onRenderFlow, onExit }: PipelineRunnerProps) => {
  const pipeline = useMemo(() => getPipelineById(pipelineId), [pipelineId]);
  const steps = useMemo(() => pipeline?.steps ?? [], [pipeline]);

  const [ctx, setCtxState] = useState<PipelineContext>(() => {
    const existing = getPipelineContext();
    if (existing && existing.pipelineId === pipelineId) return existing;
    const fresh = createFreshContext(pipelineId, pipeline?.trigger ?? "manual");
    setPipelineContext(fresh);
    return fresh;
  });

  const [runningFlow, setRunningFlow] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);

  // Create an agent_sessions row when this pipeline starts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const mode = isBrainModeEnabled() ? "auto" : "supervised";
      const { data, error } = await supabase
        .from("agent_sessions")
        .insert({ user_id: user.id, agent_mode: mode, status: "running", metadata: { pipelineId } })
        .select("id")
        .single();
      if (!cancelled && !error && data) setAgentSessionId(data.id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  const persistCtx = useCallback((next: PipelineContext) => {
    setCtxState(next);
    setPipelineContext(next);
  }, []);

  const getStepStatus = useCallback((stepId: string): StepExecutionStatus => {
    return ctx.stepStatuses[stepId] ?? "pending";
  }, [ctx.stepStatuses]);

  const advanceStep = useCallback(() => {
    setRunningFlow(false);
    setCtxState((prev) => {
      const stepId = steps[prev.currentStep]?.id;
      const next: PipelineContext = {
        ...prev,
        currentStep: prev.currentStep + 1,
        completedSteps: [...prev.completedSteps, stepId].filter(Boolean),
        stepDoneAt: { ...prev.stepDoneAt, [stepId]: Date.now() },
        stepStatuses: { ...prev.stepStatuses, [stepId]: "success" },
        logs: [...prev.logs, { stepId, status: "success" as const, message: `${stepId} completed successfully`, timestamp: Date.now() }],
      };
      setPipelineContext(next);
      return next;
    });
  }, [steps]);

  const skipStep = useCallback(() => {
    setRunningFlow(false);
    setCtxState((prev) => {
      const stepId = steps[prev.currentStep]?.id;
      const next: PipelineContext = {
        ...prev,
        currentStep: prev.currentStep + 1,
        skippedSteps: [...prev.skippedSteps, stepId].filter(Boolean),
        stepStatuses: { ...prev.stepStatuses, [stepId]: "skipped" },
        logs: [...prev.logs, { stepId, status: "skipped" as const, message: `${stepId} skipped by user`, timestamp: Date.now() }],
      };
      setPipelineContext(next);
      return next;
    });
  }, [steps]);

  const markFailed = useCallback((error?: string) => {
    setRunningFlow(false);
    setCtxState((prev) => {
      const stepId = steps[prev.currentStep]?.id;
      const msg = error ?? "Step failed";
      const next: PipelineContext = {
        ...prev,
        stepStatuses: { ...prev.stepStatuses, [stepId]: "failed" },
        stepErrors: { ...prev.stepErrors, [stepId]: msg },
        logs: [...prev.logs, { stepId, status: "failed" as const, message: msg, timestamp: Date.now() }],
      };
      setPipelineContext(next);
      return next;
    });
  }, [steps]);

  const retryStep = useCallback(() => {
    setCtxState((prev) => {
      const stepId = steps[prev.currentStep]?.id;
      const retries = (prev.retryCount?.[stepId] ?? 0) + 1;
      const next: PipelineContext = {
        ...prev,
        stepStatuses: { ...prev.stepStatuses, [stepId]: "pending" },
        retryCount: { ...prev.retryCount, [stepId]: retries },
        logs: [...prev.logs, { stepId, status: "running" as const, message: `Retry #${retries}`, timestamp: Date.now() }],
      };
      setPipelineContext(next);
      return next;
    });
  }, [steps]);

  const startStep = useCallback(() => {
    let stepIdSnap: string | undefined;
    setCtxState((prev) => {
      const stepId = steps[prev.currentStep]?.id;
      stepIdSnap = stepId;
      const next: PipelineContext = {
        ...prev,
        stepStartedAt: { ...prev.stepStartedAt, [stepId]: Date.now() },
        stepStatuses: { ...prev.stepStatuses, [stepId]: "running" },
        logs: [...prev.logs, { stepId, status: "running" as const, message: `${stepId} started`, timestamp: Date.now() }],
      };
      setPipelineContext(next);
      return next;
    });
    setRunningFlow(true);

    // Notify the agent — fire-and-forget so the flow UI is not blocked.
    if (agentSessionId && stepIdSnap) {
      const agentStep = toAgentStep(stepIdSnap);
      if (agentStep) {
        supabase.functions.invoke("run-agent-step", {
          body: { sessionId: agentSessionId, step: agentStep, context: { pipelineStepId: stepIdSnap } },
        }).catch((err) => console.warn("[agent] run-agent-step failed", err));
      }
    }
  }, [steps, agentSessionId]);

  // Mark the agent session complete when the user finishes the pipeline.
  const finalizeAgentSession = useCallback(async (status: "completed" | "cancelled") => {
    if (!agentSessionId) return;
    await supabase
      .from("agent_sessions")
      .update({ status, completed_at: new Date().toISOString() })
      .eq("id", agentSessionId);
  }, [agentSessionId]);

  // ── Layout wrapper that adds the agent side panel on desktop ──
  const withPanel = (main: React.ReactNode) => (
    <div className="flex h-full min-h-[calc(100vh-4rem)]">
      <div className="flex-1 min-w-0">{main}</div>
      {agentSessionId && agentPanelOpen && (
        <div className="hidden lg:flex w-80 xl:w-96 shrink-0 relative">
          <button
            onClick={() => setAgentPanelOpen(false)}
            className="absolute top-2 right-2 z-10 p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Hide agent panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <AgentChatPanel sessionId={agentSessionId} className="w-full" />
        </div>
      )}
      {agentSessionId && !agentPanelOpen && (
        <button
          onClick={() => setAgentPanelOpen(true)}
          className="hidden lg:flex fixed right-4 bottom-4 z-20 items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 text-xs font-medium"
        >
          <Bot className="w-3.5 h-3.5" /> Show agent
        </button>
      )}
    </div>
  );

  // ── Early returns after all hooks ──
  if (!pipeline) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-muted-foreground">Pipeline not found.</p>
        <Button variant="ghost" size="sm" onClick={onExit} className="mt-4">← Back</Button>
      </div>
    );
  }

  const currentIdx = ctx.currentStep;
  const isComplete = currentIdx >= steps.length;
  const currentStep = isComplete ? null : steps[currentIdx];
  const currentStepStatus = currentStep ? getStepStatus(currentStep.id) : "pending";

  const completedCount = ctx.completedSteps.length + ctx.skippedSteps.length;
  const failedCount = Object.values(ctx.stepStatuses).filter((s) => s === "failed").length;
  const remainingRatio = (steps.length - completedCount) / steps.length;
  const estRemaining = Math.max(1, Math.round(pipeline.estimatedMinutes * remainingRatio));
  const progressPct = Math.round((completedCount / steps.length) * 100);

  // ── Completion screen ──
  if (isComplete) {
    const handleFinish = () => { void finalizeAgentSession("completed"); clearPipelineContext(); onExit(); };
    const successCount = ctx.completedSteps.length;
    const skipCount = ctx.skippedSteps.length;

    return withPanel(
      <div className="px-4 pt-6 pb-24 animate-fade-in max-w-lg mx-auto text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold font-display mb-2">Pipeline complete</h2>
        <p className="text-sm text-muted-foreground mb-6">{pipeline.emoji} {pipeline.name}</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-green-600">{successCount}</p>
            <p className="text-[10px] text-muted-foreground">Completed</p>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-3">
            <p className="text-2xl font-bold text-muted-foreground">{skipCount}</p>
            <p className="text-[10px] text-muted-foreground">Skipped</p>
          </div>
          <div className={`border rounded-lg p-3 ${failedCount > 0 ? "bg-destructive/10 border-destructive/20" : "bg-muted/50 border-border"}`}>
            <p className={`text-2xl font-bold ${failedCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>{failedCount}</p>
            <p className="text-[10px] text-muted-foreground">Failed</p>
          </div>
        </div>

        {/* Step-by-step results */}
        <div className="bg-card border border-border rounded-lg p-4 text-left mb-6">
          <h3 className="text-sm font-semibold mb-3">Actions completed</h3>
          <div className="space-y-2">
            {steps.map((s) => {
              const status = getStepStatus(s.id);
              const errorMsg = ctx.stepErrors?.[s.id];
              const retries = ctx.retryCount?.[s.id] ?? 0;
              return (
                <div key={s.id} className="flex items-start gap-2 text-xs">
                  <div className="mt-0.5">{STATUS_ICON[status]}</div>
                  <div className="flex-1">
                    <span className={status === "skipped" || status === "failed" ? "text-muted-foreground" : ""}>
                      {s.icon} {s.label}
                    </span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{STATUS_LABEL[status]}</span>
                    {retries > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({retries} retries)</span>}
                    {errorMsg && <p className="text-destructive text-[10px] mt-0.5">{errorMsg}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Context summary */}
        {(ctx.pushSummary || ctx.invoiceData || ctx.seoData) && (
          <div className="bg-card border border-border rounded-lg p-4 text-left mb-6">
            <h3 className="text-sm font-semibold mb-3">Summary</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              {ctx.invoiceData?.lineCount && <p>✓ {ctx.invoiceData.lineCount} invoice lines processed</p>}
              {ctx.pushSummary && <p>✓ {ctx.pushSummary.created} products created, {ctx.pushSummary.updated} updated</p>}
              {ctx.pushSummary?.failed ? <p className="text-destructive">✗ {ctx.pushSummary.failed} failed to push</p> : null}
              {ctx.seoData?.titlesGenerated && <p>✓ {ctx.seoData.titlesGenerated} SEO titles generated</p>}
              {ctx.seoData?.collectionsOptimised && <p>✓ {ctx.seoData.collectionsOptimised} collection pages optimised</p>}
              {ctx.newProducts?.length && <p>✓ {ctx.newProducts.length} new products added</p>}
              {ctx.newVariants?.length && <p>✓ {ctx.newVariants.length} colour variants linked</p>}
              {ctx.refills?.length && <p>✓ {ctx.refills.length} inventory refills applied</p>}
              {ctx.images?.length && <p>✓ {ctx.images.length} images optimised</p>}
              {ctx.summaryLines?.map((line, i) => <p key={i}>✓ {line}</p>)}
            </div>
          </div>
        )}

        {/* Execution log (collapsible) */}
        {ctx.logs.length > 0 && (
          <div className="bg-card border border-border rounded-lg text-left mb-6">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="flex items-center justify-between w-full p-4 text-sm font-semibold"
            >
              Execution log ({ctx.logs.length} entries)
              {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showLogs && (
              <div className="px-4 pb-4 space-y-1 max-h-48 overflow-y-auto">
                {ctx.logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span className="text-muted-foreground shrink-0 font-mono w-16">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <div className="shrink-0">{STATUS_ICON[log.status]}</div>
                    <span className="text-muted-foreground">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={handleFinish}>Run another pipeline</Button>
          <Button variant="ghost" size="sm" onClick={handleFinish}>Back to home</Button>
        </div>
      </div>
    );
  }

  // ── Running a flow inline ──
  if (runningFlow && currentStep) {
    return withPanel(<div className="animate-fade-in">{onRenderFlow(currentStep.flow, advanceStep)}</div>);
  }

  // ── Step card (failed state shows retry) ──
  const isFailed = currentStepStatus === "failed";

  return withPanel(
    <div className="px-4 pt-2 pb-24 animate-fade-in max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onExit} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold flex-1 truncate">{pipeline.emoji} {pipeline.name}</span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3" />
          ~{estRemaining} min
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-1"><Progress value={progressPct} className="h-2" /></div>
      <div className="flex justify-between text-[10px] text-muted-foreground mb-5">
        <span>Step {currentIdx + 1} of {steps.length} — {currentStep?.label}</span>
        <span>{completedCount} done{ctx.skippedSteps.length > 0 ? `, ${ctx.skippedSteps.length} skipped` : ""}</span>
      </div>

      {/* Current step card */}
      {currentStep && (
        <div className={`border rounded-xl p-5 mb-5 ${isFailed ? "bg-destructive/5 border-destructive/30" : "bg-card border-border"}`}>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] text-muted-foreground">Step {currentIdx + 1} of {steps.length}</p>
            {isFailed && (
              <span className="text-[10px] bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">Failed</span>
            )}
            {(ctx.retryCount?.[currentStep.id] ?? 0) > 0 && (
              <span className="text-[10px] text-muted-foreground">· Attempt {(ctx.retryCount?.[currentStep.id] ?? 0) + 1}</span>
            )}
          </div>
          <h2 className="text-lg font-bold font-display mb-1">{currentStep.icon} {currentStep.label}</h2>
          <p className="text-sm text-muted-foreground mb-4">{currentStep.description}</p>

          {/* Error message */}
          {isFailed && ctx.stepErrors?.[currentStep.id] && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3 mb-4">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{ctx.stepErrors[currentStep.id]}</span>
            </div>
          )}

          {/* Context from previous steps */}
          {ctx.newProducts && ctx.newProducts.length > 0 && (
            <div className="text-xs text-muted-foreground mb-4 space-y-0.5">
              <p className="font-medium text-foreground/80">From previous steps:</p>
              <p>• {ctx.newProducts.length} new products</p>
              {ctx.newVariants && ctx.newVariants.length > 0 && <p>• {ctx.newVariants.length} new colour variants</p>}
              {ctx.refills && ctx.refills.length > 0 && <p>• {ctx.refills.length} refill items to update</p>}
            </div>
          )}

          <div className="flex gap-2">
            {isFailed ? (
              <>
                <Button onClick={retryStep} className="flex-1" variant="outline">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Retry
                </Button>
                <Button onClick={skipStep} variant="ghost" size="sm">
                  <SkipForward className="w-3.5 h-3.5 mr-1" /> Skip
                </Button>
                <Button onClick={advanceStep} variant="ghost" size="sm" className="text-muted-foreground">
                  Continue anyway →
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startStep} className="flex-1">Start this step →</Button>
                <Button variant="outline" size="sm" onClick={skipStep}>
                  <SkipForward className="w-3.5 h-3.5 mr-1" /> Skip
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step list */}
      <div className="space-y-1">
        {steps.map((s, i) => {
          const status = getStepStatus(s.id);
          const retries = ctx.retryCount?.[s.id] ?? 0;
          return (
            <div key={s.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${i === currentIdx ? "bg-primary/5" : ""}`}>
              {STATUS_ICON[status]}
              <span className={
                status === "pending" || status === "skipped" ? "text-muted-foreground" :
                status === "running" ? "font-semibold" :
                status === "failed" ? "text-destructive" : ""
              }>
                {s.icon} {s.label}
              </span>
              {retries > 0 && <span className="text-[10px] text-muted-foreground ml-auto">×{retries}</span>}
              {status === "failed" && <span className="text-[10px] text-destructive ml-auto">failed</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PipelineRunner;