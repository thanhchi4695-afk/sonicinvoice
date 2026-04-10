import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, Check, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getPipelineById, Pipeline, PipelineStep } from "@/lib/pipeline-definitions";
import {
  getPipelineContext,
  setPipelineContext,
  clearPipelineContext,
  PipelineContext,
} from "@/lib/pipeline-context";

interface PipelineRunnerProps {
  pipelineId: string;
  /** Called to render and display a flow by its key (e.g. "invoice", "feed_health") */
  onRenderFlow: (flowKey: string, onFlowComplete: () => void) => React.ReactNode;
  onExit: () => void;
}

type StepStatus = "completed" | "current" | "upcoming" | "skipped";

const PipelineRunner = ({ pipelineId, onRenderFlow, onExit }: PipelineRunnerProps) => {
  const pipeline = useMemo(() => getPipelineById(pipelineId), [pipelineId]);

  // Restore or initialise context
  const [ctx, setCtxState] = useState<PipelineContext>(() => {
    const existing = getPipelineContext();
    if (existing && existing.pipelineId === pipelineId) return existing;
    const fresh: PipelineContext = {
      pipelineId,
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
      stepStartedAt: {},
      stepDoneAt: {},
      summaryLines: [],
    };
    setPipelineContext(fresh);
    return fresh;
  });

  const [runningFlow, setRunningFlow] = useState(false);

  if (!pipeline) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-muted-foreground">Pipeline not found.</p>
        <Button variant="ghost" size="sm" onClick={onExit} className="mt-4">← Back</Button>
      </div>
    );
  }

  const steps = pipeline.steps;
  const currentIdx = ctx.currentStep;
  const isComplete = currentIdx >= steps.length;
  const currentStep = isComplete ? null : steps[currentIdx];

  const persistCtx = (next: PipelineContext) => {
    setCtxState(next);
    setPipelineContext(next);
  };

  const getStepStatus = (idx: number): StepStatus => {
    if (ctx.completedSteps.includes(steps[idx].id)) return "completed";
    if (ctx.skippedSteps.includes(steps[idx].id)) return "skipped";
    if (idx === currentIdx) return "current";
    return "upcoming";
  };

  const advanceStep = useCallback(() => {
    setRunningFlow(false);
    const next: PipelineContext = {
      ...ctx,
      currentStep: ctx.currentStep + 1,
      completedSteps: [...ctx.completedSteps, steps[ctx.currentStep].id],
      stepDoneAt: { ...ctx.stepDoneAt, [steps[ctx.currentStep].id]: Date.now() },
    };
    persistCtx(next);
  }, [ctx, steps]);

  const skipStep = useCallback(() => {
    setRunningFlow(false);
    const next: PipelineContext = {
      ...ctx,
      currentStep: ctx.currentStep + 1,
      skippedSteps: [...ctx.skippedSteps, steps[ctx.currentStep].id],
    };
    persistCtx(next);
  }, [ctx, steps]);

  const startStep = useCallback(() => {
    const started = { ...ctx, stepStartedAt: { ...ctx.stepStartedAt, [steps[ctx.currentStep].id]: Date.now() } };
    persistCtx(started);
    setRunningFlow(true);
  }, [ctx, steps]);

  const handleExit = () => {
    // Don't clear context so user can resume
    onExit();
  };

  const handleFinish = () => {
    clearPipelineContext();
    onExit();
  };

  // Calculate estimated remaining time
  const completedCount = ctx.completedSteps.length + ctx.skippedSteps.length;
  const remainingRatio = (steps.length - completedCount) / steps.length;
  const estRemaining = Math.max(1, Math.round(pipeline.estimatedMinutes * remainingRatio));
  const progressPct = Math.round((completedCount / steps.length) * 100);

  // ── Completion screen ──
  if (isComplete) {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in max-w-lg mx-auto text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold font-display mb-2">Pipeline complete</h2>
        <p className="text-sm text-muted-foreground mb-6">{pipeline.emoji} {pipeline.name}</p>

        <div className="bg-card border border-border rounded-lg p-4 text-left mb-6">
          <h3 className="text-sm font-semibold mb-3">Summary</h3>
          <div className="space-y-2">
            {steps.map((s) => {
              const status = ctx.completedSteps.includes(s.id) ? "completed" : "skipped";
              return (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  {status === "completed" ? (
                    <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  ) : (
                    <span className="text-muted-foreground shrink-0">–</span>
                  )}
                  <span className={status === "skipped" ? "text-muted-foreground" : ""}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleFinish}>Run another pipeline</Button>
          <Button variant="ghost" size="sm" onClick={handleFinish}>Back to home</Button>
        </div>
      </div>
    );
  }

  // ── Running a flow inline ──
  if (runningFlow && currentStep) {
    return (
      <div className="animate-fade-in">
        {onRenderFlow(currentStep.flow, advanceStep)}
      </div>
    );
  }

  // ── Step card ──
  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={handleExit} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold flex-1 truncate">{pipeline.emoji} {pipeline.name}</span>
      </div>

      {/* Progress */}
      <div className="mb-1">
        <Progress value={progressPct} className="h-2" />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mb-5">
        <span>Step {currentIdx + 1} of {steps.length} — {currentStep?.label}</span>
        <span>~{estRemaining} min left</span>
      </div>

      {/* Step card */}
      {currentStep && (
        <div className="bg-card border border-border rounded-xl p-5 mb-5">
          <p className="text-[10px] text-muted-foreground mb-1">Step {currentIdx + 1} of {steps.length}</p>
          <h2 className="text-lg font-bold font-display mb-1">{currentStep.label}</h2>
          <p className="text-sm text-muted-foreground mb-4">{currentStep.description}</p>

          {/* Context from previous steps */}
          {ctx.newProducts && ctx.newProducts.length > 0 && (
            <div className="text-xs text-muted-foreground mb-4 space-y-0.5">
              <p className="font-medium text-foreground/80">From previous steps:</p>
              {ctx.newProducts.length > 0 && <p>• {ctx.newProducts.length} new products</p>}
              {ctx.newVariants && ctx.newVariants.length > 0 && <p>• {ctx.newVariants.length} new colour variants</p>}
              {ctx.refills && ctx.refills.length > 0 && <p>• {ctx.refills.length} refill items to update</p>}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={startStep} className="flex-1">
              Start this step →
            </Button>
            <Button variant="outline" size="sm" onClick={skipStep}>
              <SkipForward className="w-3.5 h-3.5 mr-1" /> Skip
            </Button>
          </div>
        </div>
      )}

      {/* Step list */}
      <div className="space-y-1">
        {steps.map((s, i) => {
          const status = getStepStatus(i);
          return (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs">
              {status === "completed" && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
              {status === "current" && <span className="w-3.5 h-3.5 rounded-full bg-primary shrink-0" />}
              {status === "upcoming" && <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />}
              {status === "skipped" && <span className="text-muted-foreground shrink-0">–</span>}
              <span className={status === "upcoming" || status === "skipped" ? "text-muted-foreground" : status === "current" ? "font-semibold" : ""}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PipelineRunner;
