// Sonic Agent REST API — called by the external agent service (Vercel/Node).
// Auth: SONIC_AGENT_API_KEY header. NOT user JWT.
// Routes:
//   POST   /sonic-agent-api/runs
//   PATCH  /sonic-agent-api/runs/:run_id
//   POST   /sonic-agent-api/actions
//   PATCH  /sonic-agent-api/actions/:action_id
//   POST   /sonic-agent-api/approvals
//   GET    /sonic-agent-api/approvals/:approval_id
//   POST   /sonic-agent-api/audit

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sonic-agent-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_KEY = Deno.env.get("SONIC_AGENT_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

function getPresentedAgentKey(req: Request): string {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  return (
    req.headers.get("x-sonic-agent-key") ??
    req.headers.get("x-api-key") ??
    req.headers.get("sonic-agent-api-key") ??
    req.headers.get("sonic_agent_api_key") ??
    bearer ??
    ""
  );
}

// Constant-time string compare to avoid timing attacks.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Always compare same-length buffers to avoid leaking length via early return.
  const len = Math.max(ab.length, bb.length);
  const pa = new Uint8Array(len);
  const pb = new Uint8Array(len);
  pa.set(ab);
  pb.set(bb);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= pa[i] ^ pb[i];
  return diff === 0;
}

// ---------- Schemas ----------
const RunCreate = z.object({
  shop_id: z.string().uuid(),
  user_id: z.string().uuid().nullish(),
  trigger_type: z.string().min(1),
  trigger_payload: z.record(z.unknown()).default({}),
  planner_model: z.string().nullish(),
  executor_model: z.string().nullish(),
  plan_summary: z.string().nullish(),
  dry_run: z.boolean().default(false),
});

const RunPatch = z.object({
  status: z.string().nullish(),
  completed_at: z.string().nullish(),
  error_message: z.string().nullish(),
  plan_summary: z.string().nullish(),
});

const ActionCreate = z.object({
  run_id: z.string().uuid(),
  flow_name: z.string().min(1),
  autonomy_level: z.enum(["autonomous", "approval_gated", "never_agentic"]),
  input_payload: z.record(z.unknown()).default({}),
  diff_summary: z.string().nullish(),
});

const ActionPatch = z.object({
  status: z.string().nullish(),
  output_payload: z.record(z.unknown()).nullish(),
  diff_summary: z.string().nullish(),
  completed_at: z.string().nullish(),
  error_message: z.string().nullish(),
  approval_queue_id: z.string().uuid().nullish(),
});

const ApprovalCreate = z.object({
  run_id: z.string().uuid(),
  shop_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullish(),
  proposed_actions: z.array(z.record(z.unknown())).default([]),
  estimated_impact: z.record(z.unknown()).default({}),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  category: z.enum(["money_out", "live_ads", "live_catalog", "other"]).default("other"),
  expires_at: z.string().nullish(),
});

const AuditCreate = z.object({
  run_id: z.string().uuid().nullish(),
  action_id: z.string().uuid().nullish(),
  shop_id: z.string().uuid().nullish(),
  event_type: z.string().min(1),
  actor: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

// ---------- Audit helper ----------
async function writeAudit(row: Record<string, unknown>) {
  await admin.from("sonic_audit_log").insert(row);
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const key = getPresentedAgentKey(req);
  if (!AGENT_KEY || !timingSafeEqualStr(key, AGENT_KEY)) return unauthorized();

  const url = new URL(req.url);
  // Path after function name: /sonic-agent-api/<resource>/<id?>
  const parts = url.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("sonic-agent-api");
  const segs = fnIdx >= 0 ? parts.slice(fnIdx + 1) : parts;
  const [resource, id] = segs;

  try {
    // ----- RUNS -----
    if (resource === "runs" && req.method === "POST" && !id) {
      const parsed = RunCreate.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const { data, error } = await admin
        .from("sonic_agent_runs")
        .insert(parsed.data)
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 500);
      await writeAudit({
        run_id: data.id,
        shop_id: parsed.data.shop_id,
        event_type: "run_started",
        actor: "agent",
        payload: { trigger_type: parsed.data.trigger_type, dry_run: parsed.data.dry_run },
      });
      return json({ run_id: data.id });
    }

    if (resource === "runs" && req.method === "PATCH" && id) {
      const parsed = RunPatch.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const patch: Record<string, unknown> = { ...parsed.data };
      Object.keys(patch).forEach((k) => patch[k] === undefined || patch[k] === null ? delete patch[k] : null);
      const { data, error } = await admin
        .from("sonic_agent_runs")
        .update(patch)
        .eq("id", id)
        .select("id, shop_id, status")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "run not found" }, 404);
      await writeAudit({
        run_id: data.id,
        shop_id: data.shop_id,
        event_type: "run_updated",
        actor: "agent",
        payload: patch,
      });
      return json({ ok: true });
    }

    // ----- ACTIONS -----
    if (resource === "actions" && req.method === "POST" && !id) {
      const parsed = ActionCreate.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const { data: run } = await admin
        .from("sonic_agent_runs")
        .select("shop_id")
        .eq("id", parsed.data.run_id)
        .maybeSingle();
      if (!run) return json({ error: "run not found" }, 404);
      const { data, error } = await admin
        .from("sonic_agent_actions")
        .insert(parsed.data)
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 500);
      await writeAudit({
        run_id: parsed.data.run_id,
        action_id: data.id,
        shop_id: run.shop_id,
        event_type: "action_started",
        actor: "agent",
        payload: { flow_name: parsed.data.flow_name, autonomy_level: parsed.data.autonomy_level },
      });
      return json({ action_id: data.id });
    }

    if (resource === "actions" && req.method === "PATCH" && id) {
      const parsed = ActionPatch.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const patch: Record<string, unknown> = { ...parsed.data };
      Object.keys(patch).forEach((k) => patch[k] === undefined || patch[k] === null ? delete patch[k] : null);
      const { data, error } = await admin
        .from("sonic_agent_actions")
        .update(patch)
        .eq("id", id)
        .select("id, run_id, flow_name, status")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "action not found" }, 404);
      const { data: run } = await admin
        .from("sonic_agent_runs")
        .select("shop_id")
        .eq("id", data.run_id)
        .maybeSingle();
      const eventType =
        patch.status === "failed"
          ? "action_failed"
          : patch.status === "completed"
            ? "action_completed"
            : "action_updated";
      await writeAudit({
        run_id: data.run_id,
        action_id: data.id,
        shop_id: run?.shop_id ?? null,
        event_type: eventType,
        actor: "agent",
        payload: patch,
      });
      return json({ ok: true });
    }

    // ----- APPROVALS -----
    if (resource === "approvals" && req.method === "POST" && !id) {
      const parsed = ApprovalCreate.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const expires_at =
        parsed.data.expires_at ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from("sonic_approval_queue")
        .insert({ ...parsed.data, expires_at })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 500);
      await writeAudit({
        run_id: parsed.data.run_id,
        shop_id: parsed.data.shop_id,
        event_type: "approval_requested",
        actor: "agent",
        payload: {
          approval_id: data.id,
          title: parsed.data.title,
          priority: parsed.data.priority,
          category: parsed.data.category,
        },
      });
      return json({ approval_id: data.id });
    }

    if (resource === "approvals" && req.method === "GET" && id) {
      const { data, error } = await admin
        .from("sonic_approval_queue")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "approval not found" }, 404);
      return json(data);
    }

    // ----- AUDIT -----
    if (resource === "audit" && req.method === "POST" && !id) {
      const parsed = AuditCreate.safeParse(await req.json());
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const { error } = await admin.from("sonic_audit_log").insert(parsed.data);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Not found", path: url.pathname, method: req.method }, 404);
  } catch (err) {
    console.error("sonic-agent-api error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
