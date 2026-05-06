// Sonic Proactive Brain — runs on triggers, not user messages.
// Decides the next logical task and writes it to agent_tasks.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type TriggerSource =
  | "invoice_parse"
  | "scheduled"
  | "step_complete"
  | "stock_alert"
  | "user_request"
  | "pipeline_handoff";

interface BrainOutput {
  observation: string;
  proposed_action: string;
  requires_permission: boolean;
  permission_question: string;
  task_type: string;
  pipeline_to_run: string | null;
  next_task_type: string | null;
  skip_reason: string | null;
}

async function safeQuery<T>(p: Promise<{ data: T | null }>): Promise<T | null> {
  try {
    const { data } = await p;
    return data;
  } catch (e) {
    console.warn("safeQuery failed", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const user_id: string = body.user_id;
    const trigger_source: TriggerSource = body.trigger_source;
    const trigger_context = body.trigger_context ?? {};

    if (!user_id || !trigger_source) {
      return new Response(
        JSON.stringify({ error: "user_id and trigger_source are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Gather app state (each query is best-effort — tables may not exist)
    const [recentTasks, pendingEmails, recentInvoices, lowStockBrands] =
      await Promise.all([
        safeQuery(
          supabase
            .from("agent_tasks")
            .select("task_type, status, created_at, result_summary")
            .eq("user_id", user_id)
            .in("status", ["completed", "suggested", "approved", "running"])
            .order("created_at", { ascending: false })
            .limit(10) as any,
        ),
        safeQuery(
          supabase
            .from("email_inbox")
            .select("id, from_supplier, received_at")
            .eq("user_id", user_id)
            .eq("status", "pending")
            .limit(10) as any,
        ),
        safeQuery(
          supabase
            .from("import_history")
            .select("id, supplier_name, product_count, created_at")
            .eq("user_id", user_id)
            .order("created_at", { ascending: false })
            .limit(5) as any,
        ),
        safeQuery(
          supabase
            .from("brand_stats")
            .select("brand_name, total_invoices_parsed, avg_accuracy")
            .eq("user_id", user_id)
            .lt("avg_accuracy", 0.7)
            .limit(5) as any,
        ),
      ]);

    // 2. Build the brain prompt
    const systemPrompt = `You are Sonic's proactive task manager for an Australian swimwear retail store. You run automatically when triggered by app events — not when the user types. Your job is to notice what just happened, check what's pending, and decide what to do next.

RULES:
- Always ask permission before multi-step tasks or anything destructive
- Never act silently — every proposed action gets reported in chat
- Pick the most logical NEXT step, not the most ambitious one
- Be brief and practical — the user is a busy retail buyer
- If nothing needs doing, set task_type to "none" and explain in skip_reason

TASK GRAPH (what logically follows what):
parse_invoice → generate_tags → generate_seo → update_feed → write_social
stock_check → reorder
markdown_ladder → season_close pipeline

VALID task_type values: parse_invoice, generate_tags, generate_seo, update_feed, write_social, stock_check, reorder, markdown_ladder, morning_briefing, pipeline_new_arrivals, pipeline_restock, pipeline_seo_boost, pipeline_marketing, pipeline_season_close, none

VALID pipeline_to_run values: new_arrivals, restock, seo_boost, marketing_launch, season_close, null

CURRENT APP STATE:
Trigger: ${trigger_source}
Context: ${JSON.stringify(trigger_context)}
Recent tasks (last 10): ${JSON.stringify(recentTasks ?? [])}
Pending emails: ${pendingEmails?.length ?? 0}
Recent imports: ${JSON.stringify(recentInvoices ?? [])}
Low accuracy brands: ${JSON.stringify(lowStockBrands ?? [])}

Respond ONLY with a valid JSON object matching this shape:
{
  "observation": string,
  "proposed_action": string,
  "requires_permission": boolean,
  "permission_question": string,
  "task_type": string,
  "pipeline_to_run": string | null,
  "next_task_type": string | null,
  "skip_reason": string | null
}
No prose. No markdown.`;

    const userPrompt = `Based on the trigger and app state above, what should Sonic do next? Decide and respond in JSON.`;

    // 3. Call Claude
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("Claude error", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Claude call failed", status: aiResponse.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResponse.json();
    const rawText: string = aiData.content?.[0]?.text ?? "{}";

    // Strip ```json fences if model added them
    const cleaned = rawText.replace(/^```json\s*|```$/g, "").trim();

    let brain: BrainOutput;
    try {
      brain = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Brain parse failed", raw: rawText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Save the task
    if (brain.task_type && brain.task_type !== "none") {
      const { data: task, error: insertError } = await supabase
        .from("agent_tasks")
        .insert({
          user_id,
          task_type: brain.task_type,
          trigger_source,
          trigger_context,
          status: brain.requires_permission ? "permission_requested" : "suggested",
          observation: brain.observation,
          proposed_action: brain.proposed_action,
          permission_question: brain.permission_question,
          next_task_type: brain.next_task_type,
          pipeline_id: brain.pipeline_to_run,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Insert agent_task failed", insertError);
        return new Response(
          JSON.stringify({ error: "Insert failed", detail: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          task_id: task?.id,
          observation: brain.observation,
          proposed_action: brain.proposed_action,
          requires_permission: brain.requires_permission,
          permission_question: brain.permission_question,
          pipeline_to_run: brain.pipeline_to_run,
          next_task_type: brain.next_task_type,
          skip_reason: brain.skip_reason,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ skipped: true, reason: brain.skip_reason ?? "Nothing to do" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("proactive-brain error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
