import { supabase } from "@/integrations/supabase/client";
import {
  TASK_LABELS,
  PIPELINE_LABELS,
  PIPELINE_NEXT_PIPELINE,
  type TaskType,
} from "./agent-task-graph";

export interface PipelineStepCompleteParams {
  userId: string;
  pipelineId: string;
  pipelineLabel: string;
  completedStep: string;
  stepIndex: number;
  totalSteps: number;
  isLastStep: boolean;
  context?: Record<string, unknown>;
}

export async function onPipelineStepComplete(
  params: PipelineStepCompleteParams,
) {
  const {
    userId,
    pipelineId,
    pipelineLabel,
    completedStep,
    stepIndex,
    totalSteps,
    isLastStep,
    context = {},
  } = params;

  const stepLabel =
    TASK_LABELS[completedStep as TaskType] ?? completedStep;

  // Mark the completed step as a done agent_task entry
  await supabase.from("agent_tasks").insert({
    user_id: userId,
    task_type: completedStep,
    trigger_source: "pipeline_handoff",
    trigger_context: {
      pipeline_id: pipelineId,
      step_index: stepIndex,
      total_steps: totalSteps,
      ...context,
    },
    status: "completed",
    observation: `${stepLabel} completed (step ${stepIndex + 1} of ${totalSteps}) in the ${pipelineLabel} pipeline.`,
    completed_at: new Date().toISOString(),
  });

  // Last step → suggest the next pipeline
  if (isLastStep) {
    const suggestedPipeline = PIPELINE_NEXT_PIPELINE[pipelineId] ?? null;
    if (suggestedPipeline) {
      const nextLabel =
        PIPELINE_LABELS[suggestedPipeline] ??
        suggestedPipeline.replace(/_/g, " ");
      await supabase.from("agent_tasks").insert({
        user_id: userId,
        task_type: `pipeline_${suggestedPipeline}`,
        trigger_source: "step_complete",
        trigger_context: {
          after_pipeline: pipelineId,
          after_pipeline_label: pipelineLabel,
        },
        status: "permission_requested",
        observation: `${pipelineLabel} pipeline is done. The natural next step is the ${nextLabel} pipeline.`,
        proposed_action: `Run the ${nextLabel} pipeline`,
        permission_question: `Want me to start the ${nextLabel} pipeline now? It follows on naturally from what we just did.`,
        pipeline_id: suggestedPipeline,
      });
    }
    return;
  }

  // Mid-pipeline → fire the proactive brain for the next step
  try {
    await supabase.functions.invoke("proactive-brain", {
      body: {
        user_id: userId,
        trigger_source: "step_complete",
        trigger_context: {
          completed_step: completedStep,
          pipeline_id: pipelineId,
          step_index: stepIndex,
          total_steps: totalSteps,
          ...context,
        },
      },
    });
  } catch (e) {
    console.warn("[pipeline-trigger] brain invoke failed:", e);
  }
}

/**
 * Posts a lightweight progress note into the chat thread so the user
 * sees pipeline movement even if they're not on the pipeline screen.
 */
export async function reportStepProgressInChat(params: {
  userId: string;
  stepLabel: string;
  stepIndex: number;
  totalSteps: number;
  pipelineLabel: string;
}) {
  const { userId, stepLabel, stepIndex, totalSteps, pipelineLabel } = params;
  const isLast = stepIndex === totalSteps - 1;
  const content = isLast
    ? `Done — ${pipelineLabel} pipeline complete. All ${totalSteps} steps finished.`
    : `Step ${stepIndex + 1}/${totalSteps} done: ${stepLabel}. Moving to the next step.`;
  try {
    await supabase
      .from("chat_messages")
      .insert([{ user_id: userId, role: "assistant", content } as never]);
  } catch (e) {
    console.warn("[pipeline-trigger] chat report failed:", e);
  }
}
