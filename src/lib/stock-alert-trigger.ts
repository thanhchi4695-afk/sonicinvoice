import { supabase } from "@/integrations/supabase/client";

/**
 * Insert a "reorder" agent_task so Sonic suggests drafting a reorder
 * email in the chat thread. Fire-and-forget — never blocks the UI.
 */
export async function triggerStockAlertBrain(params: {
  userId: string;
  brandName: string;
  lowSizes: string[];
  currentQty: number;
  threshold: number;
}) {
  const { userId, brandName, lowSizes, currentQty, threshold } = params;
  try {
    await supabase.from("agent_tasks").insert({
      user_id: userId,
      task_type: "reorder",
      trigger_source: "stock_alert",
      trigger_context: {
        brand_name: brandName,
        low_sizes: lowSizes,
        current_qty: currentQty,
        threshold,
      },
      status: "permission_requested",
      observation:
        `${brandName} is running low on sizes ${lowSizes.join(", ")} ` +
        `(${currentQty} units remaining, threshold is ${threshold}).`,
      proposed_action: `Draft a reorder email to ${brandName}`,
      permission_question:
        `${brandName} sizes ${lowSizes.join(", ")} are below your reorder ` +
        `threshold. Want me to draft a reorder email to them now?`,
      pipeline_id: null,
    });
  } catch (e) {
    console.warn("[stock-alert-trigger] insert failed:", e);
  }
}
