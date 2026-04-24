/**
 * run-agent-step
 * Drives a single step of the agent pipeline:
 *  1. Validate session + auth
 *  2. Check budget (degrade if needed)
 *  3. Call Claude (or use deterministic fallback)
 *  4. Insert agent_step_runs + agent_decisions rows
 *  5. Update agent_sessions (current_step, status, narrative, cost, gate_count)
 *
 * NOTE: This function does NOT yet call the underlying domain edge functions
 *       (parse-invoice, stock-matcher, etc). Part 10.4 wires those in.
 *       For now it makes a decision based on whatever `context` the client passes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, getToolArgs, AIGatewayError } from "../_shared/ai-gateway.ts";
import { AGENT_SYSTEM_PROMPT, buildUserMessage, STEP_RUBRICS } from "../_shared/agent-system-prompt.ts";
import { checkBudget } from "../_shared/check-budget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_STEPS = new Set(["capture", "extract", "stock_check", "enrich", "price", "publish"]);
const MANDATORY_GATES = new Set(["price", "publish"]);

type Decision = "proceed" | "gate" | "retry" | "skip" | "escalate";

interface AgentDecision {
  decision: Decision;
  confidence: number;
  narrative: string;
  gate_question: string | null;
  gate_options: string[] | null;
  metadata: Record<string, unknown>;
}

const DECISION_TOOL = {
  type: "function",
  function: {
    name: "record_decision",
    description: "Record the agent's decision for this step.",
    parameters: {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["proceed", "gate", "retry", "skip", "escalate"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        narrative: { type: "string" },
        gate_question: { type: ["string", "null"] },
        gate_options: { type: ["array", "null"], items: { type: "string" } },
        metadata: { type: "object", additionalProperties: true },
      },
      required: ["decision", "confidence", "narrative"],
      additionalProperties: false,
    },
  },
};

function deterministicDecision(step: string, context: Record<string, unknown>): AgentDecision {
  // Look at edge-function-style confidence in the context if present.
  const ctxConfidence = typeof context.confidence === "number" ? (context.confidence as number) : 0.8;
  const isMandatoryGate = MANDATORY_GATES.has(step);
  if (isMandatoryGate) {
    return {
      decision: "gate",
      confidence: ctxConfidence,
      narrative: `${step} step complete — review required before continuing (budget saver mode).`,
      gate_question: step === "price" ? "Approve proposed pricing?" : "Push to your store?",
      gate_options: ["Approve", "Edit", "Cancel"],
      metadata: { mode: "deterministic", reason: "mandatory_gate" },
    };
  }
  if (ctxConfidence >= 0.85) {
    return {
      decision: "proceed",
      confidence: ctxConfidence,
      narrative: `${step} step complete (budget saver mode).`,
      gate_question: null,
      gate_options: null,
      metadata: { mode: "deterministic" },
    };
  }
  return {
    decision: "gate",
    confidence: ctxConfidence,
    narrative: `${step} step complete — items need review (budget saver mode).`,
    gate_question: "Review and continue?",
    gate_options: ["Continue", "Edit", "Cancel"],
    metadata: { mode: "deterministic" },
  };
}

function statusFromDecision(d: Decision): string {
  switch (d) {
    case "proceed": return "done";
    case "gate":    return "needs_review";
    case "skip":    return "skipped";
    case "retry":
    case "escalate": return "failed";
  }
}

function estimateCostCents(promptTokens?: number, completionTokens?: number): number {
  // Rough Haiku-tier estimate: $1/MTok in, $5/MTok out → cents
  const inCost = ((promptTokens ?? 0) / 1_000_000) * 100;
  const outCost = ((completionTokens ?? 0) / 1_000_000) * 500;
  return Math.max(1, Math.ceil(inCost + outCost));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // ── Input ──
    const body = await req.json().catch(() => ({}));
    const { sessionId, step, context = {}, attempt = 1 } = body as {
      sessionId?: string; step?: string; context?: Record<string, unknown>; attempt?: number;
    };
    if (!sessionId || typeof sessionId !== "string") {
      return new Response(JSON.stringify({ error: "sessionId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!step || !VALID_STEPS.has(step)) {
      return new Response(JSON.stringify({ error: `step must be one of ${[...VALID_STEPS].join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify session ownership
    const { data: session, error: sessionErr } = await admin
      .from("agent_sessions")
      .select("id, user_id, total_cost_cents, gate_count, metadata")
      .eq("id", sessionId)
      .maybeSingle();

    // Resolve supplier hint from context or session metadata, then fetch
    // supplier hints + brand rules for the system prompt.
    const supplierName =
      (typeof context.supplier === "string" && context.supplier) ||
      (typeof context.supplier_name === "string" && context.supplier_name) ||
      ((session?.metadata as Record<string, unknown> | null)?.supplier as string | undefined) ||
      null;
    let supplierHints: string | null = null;
    let brandRulesText: string | null = null;
    if (supplierName) {
      const [{ data: hints }, { data: rules }] = await Promise.all([
        admin.rpc("get_supplier_hints", { _supplier: supplierName, _user_id: userId, _limit: 25 }),
        admin.rpc("get_brand_rules_text", { _supplier: supplierName }),
      ]);
      supplierHints = (hints as string | null) ?? null;
      brandRulesText = (rules as string | null) ?? null;
    }
    if (sessionErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Insert running step run ──
    const { data: stepRun, error: stepErr } = await admin
      .from("agent_step_runs")
      .insert({
        session_id: sessionId,
        user_id: userId,
        step,
        attempt,
        status: "running",
        input: context,
      })
      .select("id")
      .single();
    if (stepErr || !stepRun) {
      console.error("Failed to insert step run:", stepErr);
      return new Response(JSON.stringify({ error: "Could not start step" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stepRunId = stepRun.id;

    // ── Budget ──
    const budget = await checkBudget(supabaseUrl, serviceKey, userId, sessionId, 2);
    let agentDecision: AgentDecision;
    let costCents = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let model = "deterministic";

    if (!budget.ok) {
      // Hard cap hit — fall back to deterministic decision, no Claude call
      agentDecision = deterministicDecision(step, context);
      agentDecision.metadata = { ...agentDecision.metadata, budget_reason: budget.reason };
      // Mark session degraded
      await admin
        .from("agent_sessions")
        .update({ metadata: { ...(session.metadata as Record<string, unknown> ?? {}), degraded: true, budget_reason: budget.reason } })
        .eq("id", sessionId);
    } else {
      // ── Call Claude via AI gateway ──
      try {
        const userMsg = buildUserMessage(step, context, attempt, budget.remainingCents, supplierHints ?? undefined, brandRulesText ?? undefined);
        const aiResponse = await callAI({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPT },
            { role: "user", content: userMsg },
          ],
          temperature: 0.2,
          tools: [DECISION_TOOL],
          tool_choice: { type: "function", function: { name: "record_decision" } },
        });
        model = "google/gemini-3-flash-preview";
        const argsRaw = getToolArgs(aiResponse);
        if (!argsRaw) throw new Error("AI returned no decision tool call");
        const parsed = JSON.parse(argsRaw) as Partial<AgentDecision>;
        agentDecision = {
          decision: (parsed.decision ?? "gate") as Decision,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          narrative: parsed.narrative ?? `${step} step complete.`,
          gate_question: parsed.gate_question ?? null,
          gate_options: parsed.gate_options ?? null,
          metadata: parsed.metadata ?? {},
        };
        // Enforce mandatory gates regardless of model output
        if (MANDATORY_GATES.has(step) && agentDecision.decision === "proceed") {
          agentDecision.decision = "gate";
          agentDecision.metadata = { ...agentDecision.metadata, forced_gate: true };
        }
        // Token estimates aren't returned by the gateway shape we have — approximate from message length
        promptTokens = Math.ceil((AGENT_SYSTEM_PROMPT.length + userMsg.length) / 4);
        completionTokens = Math.ceil(argsRaw.length / 4);
        costCents = estimateCostCents(promptTokens, completionTokens);
      } catch (aiErr) {
        console.error("AI call failed, falling back to deterministic:", aiErr);
        agentDecision = deterministicDecision(step, context);
        agentDecision.metadata = { ...agentDecision.metadata, ai_error: aiErr instanceof AIGatewayError ? aiErr.message : String(aiErr) };
      }
    }

    const durationMs = Date.now() - startedAt;
    const newStatus = statusFromDecision(agentDecision.decision);

    // ── Update step run ──
    await admin
      .from("agent_step_runs")
      .update({
        status: newStatus,
        confidence: agentDecision.confidence,
        narrative: agentDecision.narrative,
        output: { decision: agentDecision },
        duration_ms: durationMs,
        cost_cents: costCents,
        ended_at: new Date().toISOString(),
      })
      .eq("id", stepRunId);

    // ── Insert decision row ──
    await admin.from("agent_decisions").insert({
      step_run_id: stepRunId,
      session_id: sessionId,
      user_id: userId,
      decision_type: agentDecision.decision,
      confidence: agentDecision.confidence,
      reasoning: agentDecision.narrative,
      model,
      prompt_tokens: promptTokens || null,
      completion_tokens: completionTokens || null,
      cost_cents: costCents,
    });

    // ── Update session ──
    const newGateCount = (session.gate_count ?? 0) + (agentDecision.decision === "gate" ? 1 : 0);
    let sessionStatus: string | undefined;
    if (agentDecision.decision === "gate") sessionStatus = "awaiting_gate";
    else if (agentDecision.decision === "escalate") sessionStatus = "failed";
    else if (step === "publish" && agentDecision.decision === "proceed") sessionStatus = "completed";
    else sessionStatus = "running";

    await admin
      .from("agent_sessions")
      .update({
        current_step: step,
        last_narrative: agentDecision.narrative,
        gate_count: newGateCount,
        total_cost_cents: (session.total_cost_cents ?? 0) + costCents,
        status: sessionStatus,
        completed_at: sessionStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", sessionId);

    // ── Update budgets ──
    if (costCents > 0) {
      await admin.rpc as never; // not strictly needed
      // Use raw update via SQL would need rpc; simple read-modify-write is fine for now
      const { data: budgetRow } = await admin
        .from("agent_budgets")
        .select("spent_cents")
        .eq("user_id", userId)
        .maybeSingle();
      if (budgetRow) {
        await admin
          .from("agent_budgets")
          .update({ spent_cents: (budgetRow.spent_cents ?? 0) + costCents })
          .eq("user_id", userId);
      }
      const { data: globalRow } = await admin
        .from("agent_global_budget")
        .select("spent_cents")
        .eq("id", 1)
        .maybeSingle();
      if (globalRow) {
        await admin
          .from("agent_global_budget")
          .update({ spent_cents: (globalRow.spent_cents ?? 0) + costCents })
          .eq("id", 1);
      }
    }

    return new Response(
      JSON.stringify({
        stepRunId,
        decision: agentDecision,
        durationMs,
        costCents,
        degraded: !budget.ok,
        sessionStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("run-agent-step fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
