// Collection Agent Orchestrator — Sola-style autopilot for Shopify collections.
// Mirrors agent-orchestrator pattern: detect → decide → gate → execute → notify.
//
// Body shape:
// {
//   trigger_type: 'invoice_complete' | 'weekly_health' | 'stock_change'
//                | 'manual' | 'seo_needed' | 'process_approval',
//   user_id?: string,
//   invoice_products?: Array<{ title, vendor, product_type, tags }>,
//   invoice_label?: string,
//   product_id?: string,
//   new_qty?: number,
//   collection_handle?: string,
//   collection_title?: string,
//   approval_id?: string,         // for process_approval
// }

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getToolArgs } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Decision {
  action:
    | "CREATE_COLLECTION"
    | "DELETE_COLLECTION"
    | "ARCHIVE_COLLECTION"
    | "GENERATE_SEO"
    | "NO_ACTION";
  title?: string;
  handle?: string;
  rule_column?: string;
  rule_relation?: string;
  rule_condition?: string;
  rationale: string;
  priority?: "high" | "medium" | "low";
}

async function getUserId(req: Request, body: Record<string, unknown>): Promise<string | null> {
  if (typeof body.user_id === "string") return body.user_id;
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function detectFromInvoice(
  admin: ReturnType<typeof createClient>,
  userId: string,
  invoiceProducts: Array<{ title: string; vendor: string; product_type: string; tags: string }>,
) {
  const { data: memory } = await admin
    .from("collection_memory")
    .select("handle, title, source_type")
    .eq("user_id", userId);

  const existingHandles = new Set((memory ?? []).map((m: any) => (m.handle || "").toLowerCase()));
  const existingTitles = new Set((memory ?? []).map((m: any) => (m.title || "").toLowerCase()));

  // Brands
  const brands = new Map<string, number>();
  for (const p of invoiceProducts) {
    const v = (p.vendor || "").trim();
    if (v) brands.set(v, (brands.get(v) ?? 0) + 1);
  }

  // Style lines: first 1-2 words of title repeated 3+ times per vendor
  const styles = new Map<string, { count: number; vendor: string; sample: string }>();
  for (const p of invoiceProducts) {
    const tokens = (p.title || "").split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const styleName = tokens.slice(0, 2).join(" ");
    const key = `${p.vendor}::${styleName}`;
    const cur = styles.get(key);
    if (cur) {
      cur.count++;
    } else {
      styles.set(key, { count: 1, vendor: p.vendor || "", sample: styleName });
    }
  }

  const findings: Array<Record<string, unknown>> = [];
  for (const [vendor, count] of brands) {
    if (existingTitles.has(vendor.toLowerCase())) continue;
    if (count >= 3) findings.push({ kind: "new_brand", vendor, count });
  }
  for (const [, info] of styles) {
    if (info.count >= 3 && !existingTitles.has(info.sample.toLowerCase())) {
      findings.push({
        kind: "new_brand_story",
        vendor: info.vendor,
        style_name: info.sample,
        count: info.count,
      });
    }
  }
  return { findings, existingHandles };
}

async function aiDecide(
  findings: Array<Record<string, unknown>>,
  storeName: string,
): Promise<Decision[]> {
  if (findings.length === 0) return [];
  const sys = `You are a Shopify collection manager for ${storeName}.
For each finding, output an action. Rules:
- new_brand with 10+ products → CREATE_COLLECTION (vendor equals)
- new_brand with <10 → still CREATE if 3+ (still useful), priority low
- new_brand_story with 3+ products → CREATE_COLLECTION (title contains style_name)
- empty_collection → ARCHIVE_COLLECTION (never DELETE if it had products before)
- needs_seo → GENERATE_SEO
Always include rationale citing the trigger.`;

  const tool = {
    type: "function",
    function: {
      name: "emit_decisions",
      description: "Emit ordered list of decisions",
      parameters: {
        type: "object",
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["CREATE_COLLECTION", "DELETE_COLLECTION", "ARCHIVE_COLLECTION", "GENERATE_SEO", "NO_ACTION"],
                },
                title: { type: "string" },
                handle: { type: "string" },
                rule_column: { type: "string", enum: ["vendor", "tag", "title", "type"] },
                rule_relation: { type: "string", enum: ["equals", "contains"] },
                rule_condition: { type: "string" },
                rationale: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["action", "rationale"],
            },
          },
        },
        required: ["decisions"],
      },
    },
  };

  try {
    const resp = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify({ findings }) },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_decisions" } },
    });
    const args = getToolArgs(resp);
    if (args) {
      const parsed = JSON.parse(args);
      return parsed.decisions ?? [];
    }
  } catch (e) {
    console.warn("aiDecide failed, using rule-based fallback:", e);
  }

  // Deterministic fallback
  const out: Decision[] = [];
  for (const f of findings) {
    if (f.kind === "new_brand") {
      out.push({
        action: "CREATE_COLLECTION",
        title: String(f.vendor),
        handle: slug(String(f.vendor)),
        rule_column: "vendor",
        rule_relation: "equals",
        rule_condition: String(f.vendor),
        rationale: `New brand "${f.vendor}" detected with ${f.count} products in invoice.`,
        priority: (f.count as number) >= 10 ? "high" : "medium",
      });
    } else if (f.kind === "new_brand_story") {
      const t = String(f.style_name);
      out.push({
        action: "CREATE_COLLECTION",
        title: `${f.vendor} ${t}`,
        handle: slug(`${f.vendor} ${t}`),
        rule_column: "title",
        rule_relation: "contains",
        rule_condition: t,
        rationale: `New style line "${t}" from ${f.vendor} with ${f.count} products.`,
        priority: "medium",
      });
    } else if (f.kind === "empty_collection") {
      out.push({
        action: "ARCHIVE_COLLECTION",
        handle: String(f.handle),
        title: String(f.title ?? ""),
        rationale: `Collection has 0 products remaining — archiving (stock may return).`,
      });
    } else if (f.kind === "needs_seo") {
      out.push({
        action: "GENERATE_SEO",
        handle: String(f.handle),
        title: String(f.title ?? ""),
        rationale: `Collection has no SEO description.`,
      });
    }
  }
  return out;
}

async function gateAndQueue(
  admin: ReturnType<typeof createClient>,
  userId: string,
  workflowId: string,
  decisions: Decision[],
  settings: Record<string, unknown>,
): Promise<{ queued: number; auto_executed: number }> {
  let queued = 0;
  let autoExecuted = 0;
  const thresholdHours = (settings.auto_approve_threshold_hours as number) ?? 24;
  const autoApproveAt = new Date(Date.now() + thresholdHours * 3600_000).toISOString();

  for (const d of decisions) {
    if (d.action === "NO_ACTION") continue;

    const isBrand = d.action === "CREATE_COLLECTION" && d.rule_column === "vendor";
    const isStory = d.action === "CREATE_COLLECTION" && d.rule_column === "title";
    const isSEO = d.action === "GENERATE_SEO";
    const isArchive = d.action === "ARCHIVE_COLLECTION";

    const autoApproved =
      (isBrand && settings.auto_approve_brand_collections) ||
      (isStory && settings.auto_approve_brand_stories) ||
      (isSEO && settings.seo_auto_generate) ||
      (isArchive && settings.auto_archive_empty);

    const approvalType =
      d.action === "CREATE_COLLECTION"
        ? "create_collection"
        : d.action === "ARCHIVE_COLLECTION"
        ? "archive_collection"
        : d.action === "DELETE_COLLECTION"
        ? "delete_collection"
        : "update_seo";

    await admin.from("collection_approval_queue").insert({
      user_id: userId,
      workflow_id: workflowId,
      approval_type: approvalType,
      collection_title: d.title ?? null,
      collection_handle: d.handle ?? null,
      rationale: d.rationale,
      preview_data: {
        rule_column: d.rule_column,
        rule_relation: d.rule_relation,
        rule_condition: d.rule_condition,
        priority: d.priority,
      },
      status: autoApproved ? "auto_approved" : "pending",
      auto_approve_at: autoApproved ? null : autoApproveAt,
      decided_at: autoApproved ? new Date().toISOString() : null,
      decided_by: autoApproved ? "auto" : null,
    });

    if (autoApproved) autoExecuted++;
    else queued++;
  }
  return { queued, auto_executed: autoExecuted };
}

async function notify(settings: Record<string, unknown>, summary: string) {
  const url = settings.slack_webhook_url as string | undefined;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🤖 Collection Autopilot\n${summary}` }),
    });
  } catch (e) {
    console.warn("Slack notify failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const userId = await getUserId(req, body);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load settings (or defaults)
    const { data: settingsRow } = await admin
      .from("collection_automation_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const settings = settingsRow ?? {
      auto_approve_brand_collections: false,
      auto_approve_brand_stories: false,
      seo_auto_generate: true,
      auto_archive_empty: false,
      auto_approve_threshold_hours: 24,
    };

    const triggerType = String(body.trigger_type || "manual");

    // Create workflow record
    const { data: wf, error: wfErr } = await admin
      .from("collection_workflows")
      .insert({
        user_id: userId,
        workflow_type: triggerType,
        status: "running",
        trigger_source: triggerType,
        trigger_data: body,
      })
      .select("id")
      .single();
    if (wfErr) throw wfErr;
    const workflowId = wf.id;

    // Step 1: detect
    let findings: Array<Record<string, unknown>> = [];
    if (triggerType === "invoice_complete") {
      const inv = (body.invoice_products as any[]) ?? [];
      const det = await detectFromInvoice(admin, userId, inv);
      findings = det.findings;
    } else if (triggerType === "seo_needed" && body.collection_handle) {
      findings = [{ kind: "needs_seo", handle: body.collection_handle, title: body.collection_title }];
    } else if (triggerType === "weekly_health") {
      // Placeholder — delegated UI/cron job can supply candidate findings
      findings = (body.findings as any[]) ?? [];
    }

    // Step 2: decide
    const decisions = await aiDecide(findings, body.store_name as string ?? "this store");

    // Step 3: gate + queue
    const gateResult = await gateAndQueue(admin, userId, workflowId, decisions, settings);

    // Note: actual EXECUTE happens via a separate function call
    // (process-collection-approval). Auto-approved items get executed by
    // the background cron or by client-side polling.

    const summary = `${triggerType}: ${decisions.length} decisions, ${gateResult.queued} queued, ${gateResult.auto_executed} auto-approved`;

    await admin
      .from("collection_workflows")
      .update({
        status: "complete",
        decisions: decisions as any,
        actions_taken: [],
        summary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", workflowId);

    await notify(settings as Record<string, unknown>, summary);

    return new Response(
      JSON.stringify({
        success: true,
        workflow_id: workflowId,
        findings_count: findings.length,
        decisions,
        ...gateResult,
        summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("collection-agent-orchestrator error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
