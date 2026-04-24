/**
 * agent-shadow.ts
 *
 * Shadow-logger for the classic InvoiceFlow path. Mirrors gate transitions
 * and cell edits into agent_sessions / agent_step_runs / agent_feedback so
 * the agent layer's tables get populated even when the new agent loop
 * (run-agent-step) isn't driving the run.
 *
 * Pure side-effect, fire-and-forget. Errors are swallowed — never block
 * the user's invoice flow on a logging failure.
 *
 * Edit-vs-accept classification:
 *   The Marrakesh case (user edits a value, then "Done editing" auto-accepts)
 *   gets logged as feedback_type='edit' when corrected_value !== original_value,
 *   regardless of which button was clicked. Value-diff, not button-watch.
 */

import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "agent_shadow_session_id";

type StepName = "capture" | "extract" | "stock_check" | "enrich" | "price" | "publish";
type StepStatus = "running" | "done" | "needs_review" | "skipped" | "failed";
type FeedbackType = "accept" | "edit" | "reject" | "override";

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch { return null; }
}

/** Start a new shadow session. Returns session id (or null on failure). */
export async function startShadowSession(opts: {
  supplier?: string;
  invoiceId?: string;
  trigger?: string;
}): Promise<string | null> {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from("agent_sessions")
      .insert({
        user_id: userId,
        agent_mode: "shadow",
        status: "running",
        invoice_id: opts.invoiceId ?? null,
        metadata: {
          supplier: opts.supplier ?? null,
          trigger: opts.trigger ?? "invoice_upload",
          shadow: true,
        },
      })
      .select("id")
      .single();
    if (error || !data) return null;
    try { sessionStorage.setItem(SESSION_KEY, data.id); } catch { /* ignore */ }
    return data.id;
  } catch { return null; }
}

export function getShadowSessionId(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function clearShadowSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Log a step boundary (start / complete). Returns step_run_id. */
export async function logShadowStep(opts: {
  step: StepName;
  status: StepStatus;
  narrative?: string;
  confidence?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
}): Promise<string | null> {
  try {
    const userId = await currentUserId();
    const sessionId = getShadowSessionId();
    if (!userId || !sessionId) return null;
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("agent_step_runs")
      .insert({
        user_id: userId,
        session_id: sessionId,
        step: opts.step,
        status: opts.status,
        narrative: opts.narrative ?? null,
        confidence: opts.confidence ?? null,
        input: opts.input ?? null,
        output: opts.output ?? null,
        duration_ms: opts.durationMs ?? null,
        ended_at: opts.status !== "running" ? now : null,
        edge_function: "shadow",
      })
      .select("id")
      .single();
    if (error || !data) return null;

    // Mirror narrative onto the session for the chat panel
    await supabase
      .from("agent_sessions")
      .update({
        current_step: opts.step,
        last_narrative: opts.narrative ?? null,
        status: opts.status === "needs_review" ? "awaiting_gate" : "running",
      })
      .eq("id", sessionId);

    return data.id;
  } catch { return null; }
}

/** Mark the shadow session complete. */
export async function completeShadowSession(narrative?: string): Promise<void> {
  try {
    const sessionId = getShadowSessionId();
    if (!sessionId) return;
    await supabase
      .from("agent_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_narrative: narrative ?? null,
      })
      .eq("id", sessionId);
    clearShadowSession();
  } catch { /* ignore */ }
}

/**
 * Log a single piece of feedback. CRITICAL: classification is value-based.
 * If `original` and `corrected` differ, feedback_type is forced to 'edit'
 * even when the caller passes 'accept'. This catches the Marrakesh case
 * where the user typed a new value then clicked "Done editing" (which
 * auto-accepts — there is no separate Edit button).
 */
export async function logShadowFeedback(opts: {
  feedbackType: FeedbackType;
  original?: unknown;
  corrected?: unknown;
  field?: string;
  supplier?: string;
  stepRunId?: string | null;
  deltaReason?: string;
}): Promise<void> {
  try {
    const userId = await currentUserId();
    const sessionId = getShadowSessionId();
    if (!userId || !sessionId) return;

    // Value-diff classification (Lovable's flagged gap).
    let ftype: FeedbackType = opts.feedbackType;
    const o = opts.original;
    const c = opts.corrected;
    const valuesDiffer =
      (o !== undefined || c !== undefined) &&
      JSON.stringify(o ?? null) !== JSON.stringify(c ?? null);
    if (ftype === "accept" && valuesDiffer) ftype = "edit";

    await supabase.from("agent_feedback").insert({
      user_id: userId,
      session_id: sessionId,
      step_run_id: opts.stepRunId ?? null,
      feedback_type: ftype,
      original_value: o === undefined ? null : (o as never),
      corrected_value: c === undefined ? null : (c as never),
      supplier: opts.supplier ?? null,
      delta_reason:
        opts.deltaReason ??
        (valuesDiffer && opts.field ? `edited ${opts.field}` : null),
    });
  } catch { /* ignore */ }
}
