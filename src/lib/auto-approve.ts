import { supabase } from "@/integrations/supabase/client";
import { executeChatAction } from "./sonic-chat-actions";

// Tasks that can be auto-approved (low risk, reversible)
export const AUTO_APPROVABLE_TASKS = [
  "generate_tags",
  "generate_seo",
  "stock_check",
] as const;

// Tasks that always require permission (irreversible
// or push data to external systems)
export const ALWAYS_REQUIRES_PERMISSION = [
  "update_feed",
  "write_social",
  "reorder",
  "export_csv",
  "parse_pending_emails",
  "markdown_ladder",
  "pipeline_season_close",
] as const;

// Map agent_task task_type → SonicDecision action key
const TASK_TYPE_TO_ACTION: Record<string, string> = {
  generate_tags: "open_tag_engine",
  generate_seo: "open_seo_writer",
  stock_check: "open_stock_monitor",
};

export async function checkAndAutoApprove(
  taskId: string,
  taskType: string,
  userId: string,
): Promise<boolean> {
  if ((ALWAYS_REQUIRES_PERMISSION as readonly string[]).includes(taskType)) {
    return false;
  }

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("auto_approve_tags, auto_approve_seo, proactive_mode_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (!prefs?.proactive_mode_enabled) return false;

  const shouldAutoApprove =
    (taskType === "generate_tags" && prefs.auto_approve_tags) ||
    (taskType === "generate_seo" && prefs.auto_approve_seo) ||
    taskType === "stock_check";

  if (!shouldAutoApprove) return false;

  await supabase
    .from("agent_tasks")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  try {
    const action = TASK_TYPE_TO_ACTION[taskType];
    if (action) {
      executeChatAction({
        action,
        params: {},
        requires_permission: false,
        intent: "action",
        confidence: 1,
      } as never);
    }
    await supabase
      .from("agent_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result_summary: `Auto-completed: ${taskType}`,
      })
      .eq("id", taskId);
  } catch (e) {
    console.warn("[auto-approve] action failed:", e);
    await supabase
      .from("agent_tasks")
      .update({ status: "failed" })
      .eq("id", taskId);
  }

  return true;
}
