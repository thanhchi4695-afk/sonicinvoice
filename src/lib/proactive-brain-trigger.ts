// Fire-and-forget trigger for the Sonic proactive brain.
// Called after successful invoice parses, scheduled jobs, etc.
// Never throws — never blocks the calling UI.
import { supabase } from "@/integrations/supabase/client";

export type ProactiveTriggerSource =
  | "invoice_parse"
  | "scheduled"
  | "step_complete"
  | "stock_alert"
  | "user_request"
  | "pipeline_handoff";

export async function triggerProactiveBrain(
  userId: string,
  trigger_source: ProactiveTriggerSource,
  trigger_context: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.functions.invoke("proactive-brain", {
      body: { user_id: userId, trigger_source, trigger_context },
    });
  } catch (e) {
    // Fail silently — never block the calling UI.
    console.warn("[proactive-brain] trigger failed:", e);
  }
}

/** Convenience wrapper for the most common trigger. */
export function triggerAfterInvoiceParse(
  userId: string,
  invoiceId: string,
  brandName: string,
  productCount: number,
): void {
  triggerProactiveBrain(userId, "invoice_parse", {
    invoice_id: invoiceId,
    brand_name: brandName,
    product_count: productCount,
  }).catch(() => {});
}
