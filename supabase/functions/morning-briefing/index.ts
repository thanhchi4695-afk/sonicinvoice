import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Safe wrapper — returns [] when a table doesn't exist in this project yet.
async function safeSelect<T = unknown>(
  fn: () => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn("[morning-briefing] query warning:", error);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.warn("[morning-briefing] query threw:", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const secret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: users, error: usersErr } = await supabase
    .from("user_preferences")
    .select("user_id, briefing_hour_utc")
    .eq("morning_briefing_enabled", true);

  if (usersErr) {
    console.error("[morning-briefing] failed to load users:", usersErr);
    return new Response(
      JSON.stringify({ error: "failed to load users" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  if (!users?.length) {
    return new Response(
      JSON.stringify({ processed: 0 }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const currentHour = new Date().getUTCHours();
  let processed = 0;

  for (const user of users) {
    if (user.briefing_hour_utc !== currentHour) continue;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [pendingEmails, recentImports, pendingTasks, lowAccuracyBrands] =
      await Promise.all([
        safeSelect<{ id: string; from_supplier?: string; received_at: string }>(
          () =>
            supabase
              .from("email_inbox")
              .select("id, from_supplier, received_at")
              .eq("user_id", user.user_id)
              .eq("status", "pending"),
        ),
        safeSelect<{
          supplier_name?: string;
          product_count?: number;
          created_at: string;
        }>(() =>
          supabase
            .from("import_history")
            .select("supplier_name, product_count, created_at")
            .eq("user_id", user.user_id)
            .gte("created_at", since)
            .order("created_at", { ascending: false }),
        ),
        safeSelect<{ task_type: string; observation: string; created_at: string }>(
          () =>
            supabase
              .from("agent_tasks")
              .select("task_type, observation, created_at")
              .eq("user_id", user.user_id)
              .in("status", ["suggested", "permission_requested"])
              .order("created_at", { ascending: false })
              .limit(5),
        ),
        safeSelect<{ brand_name: string; avg_accuracy: number; total_invoices_parsed: number }>(
          () =>
            supabase
              .from("brand_stats")
              .select("brand_name, avg_accuracy, total_invoices_parsed")
              .eq("user_id", user.user_id)
              .lt("avg_accuracy", 0.75)
              .order("total_invoices_parsed", { ascending: false })
              .limit(3),
        ),
      ]);

    const emailsLines = pendingEmails
      .map(
        (e) =>
          `  - ${e.from_supplier ?? "unknown"} (arrived ${new Date(
            e.received_at,
          ).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })})`,
      )
      .join("\n");

    const importsLines = recentImports
      .map(
        (i) => `  - ${i.supplier_name ?? "unknown"}: ${i.product_count ?? 0} products`,
      )
      .join("\n");

    const lowAccText = lowAccuracyBrands.length
      ? lowAccuracyBrands
          .map(
            (b) =>
              `${b.brand_name} (${Math.round((b.avg_accuracy ?? 0) * 100)}%)`,
          )
          .join(", ")
      : "none";

    const userContent = `Write today's morning briefing.
Pending emails: ${pendingEmails.length}
${emailsLines}
Parsed yesterday: ${recentImports.length} invoices
${importsLines}
Pending tasks: ${pendingTasks.length} awaiting approval
Low accuracy brands: ${lowAccText}`;

    let briefingText = "Nothing urgent today.";
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: `You are Sonic, writing a morning briefing for an Australian retail store owner. Be direct and practical.
Max 4 bullet points. No greetings. No fluff.
Lead with the most urgent thing.
Format each bullet as one plain sentence.
End with one suggested action for today.
Respond as plain text — no JSON, no markdown.`,
          messages: [{ role: "user", content: userContent }],
        }),
      });
      const aiData = await response.json();
      briefingText = aiData?.content?.[0]?.text ?? briefingText;
    } catch (e) {
      console.error("[morning-briefing] AI call failed:", e);
    }

    const { error: insErr } = await supabase.from("agent_tasks").insert({
      user_id: user.user_id,
      task_type: "morning_briefing",
      trigger_source: "scheduled",
      trigger_context: {
        pending_emails: pendingEmails.length,
        parsed_yesterday: recentImports.length,
        pending_tasks: pendingTasks.length,
      },
      status: "completed",
      observation: briefingText,
      proposed_action: null,
      result_summary: briefingText,
      completed_at: new Date().toISOString(),
    });

    if (insErr) {
      console.error("[morning-briefing] insert failed:", insErr);
    } else {
      processed++;
    }
  }

  return new Response(
    JSON.stringify({ processed }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
