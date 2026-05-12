// silent-training-dispatcher — cron-driven.
// Picks unprocessed rows from gmail_found_invoices and invokes
// parse-invoice-silent for each, respecting:
//   - app_settings.training_pipeline_enabled kill switch
//   - daily_silent_parse_cap (workspace-wide, today)
//   - per-mailbox throttle: 50 attachments/day per connection_id
//   - sequential pacing (500ms min) to honour AI gateway concurrency rules

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_CRON_SECRET = Deno.env.get("CRON_SECRET");
let CACHED_CRON_SECRET: string | null = null;
async function getCronSecret(admin: any): Promise<string | null> {
  if (CACHED_CRON_SECRET) return CACHED_CRON_SECRET;
  if (ENV_CRON_SECRET) { CACHED_CRON_SECRET = ENV_CRON_SECRET; return CACHED_CRON_SECRET; }
  try {
    const { data } = await admin.rpc("get_cron_secret");
    if (typeof data === "string" && data.length > 0) { CACHED_CRON_SECRET = data; return data; }
  } catch { /* */ }
  return null;
}

const PER_MAILBOX_DAILY_LIMIT = 50;
const MAX_BATCH_PER_RUN = 25;
const MIN_DELAY_MS = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: any = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: cron secret (env or vault) OR service role
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const auth = req.headers.get("authorization") || "";
  const cronSecret = await getCronSecret(admin);
  const ok = (cronSecret && cronHeader === cronSecret) || auth === `Bearer ${SERVICE_KEY}`;
  console.log(JSON.stringify({
    msg: "auth_check",
    has_cron_header: cronHeader.length > 0,
    cron_header_len: cronHeader.length,
    has_secret: !!cronSecret,
    secret_len: cronSecret?.length ?? 0,
    has_auth_bearer: auth.startsWith("Bearer "),
    ok,
  }));
  if (!ok) return json({ error: "Unauthorized" }, 401);



  // 1. Kill switch
  const { data: settings } = await admin
    .from("app_settings")
    .select("training_pipeline_enabled, daily_silent_parse_cap")
    .eq("singleton", true)
    .maybeSingle();
  if (!settings?.training_pipeline_enabled) {
    return json({ skipped: "training_pipeline_disabled" });
  }
  const dailyCap: number = settings.daily_silent_parse_cap ?? 500;

  // 2. Workspace-wide cap check
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await admin
    .from("training_parses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  const todayUsed = todayCount ?? 0;
  if (todayUsed >= dailyCap) {
    return json({ skipped: "daily_cap_reached", todayUsed, dailyCap });
  }
  const remaining = dailyCap - todayUsed;
  const batchTarget = Math.min(MAX_BATCH_PER_RUN, remaining);

  // Optional manual mode: { force_found_invoice_id }
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  if (body?.force_found_invoice_id) {
    const r = await invokeSilent(body.force_found_invoice_id);
    return json({ manual: true, result: r });
  }

  // 3. Pull candidate rows (oldest first → backfill historical first)
  const { data: candidates } = await admin
    .from("gmail_found_invoices")
    .select("id, user_id, connection_id, attachments, received_at")
    .is("silent_processed_at", null)
    .order("received_at", { ascending: true })
    .limit(200);

  if (!candidates || candidates.length === 0) {
    return json({ ok: true, processed: 0, message: "no candidates" });
  }

  // 4. Per-mailbox throttle: count today's silent processed per connection
  const connectionIds = Array.from(new Set(candidates.map((c: any) => c.connection_id).filter(Boolean)));
  const perMailboxToday = new Map<string, number>();
  for (const cid of connectionIds) {
    const { count } = await admin
      .from("gmail_found_invoices")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", cid)
      .gte("silent_processed_at", todayStart.toISOString());
    perMailboxToday.set(cid, count ?? 0);
  }

  const results: any[] = [];
  let processed = 0;

  for (const row of candidates) {
    if (processed >= batchTarget) break;
    if (!Array.isArray(row.attachments) || row.attachments.length === 0) {
      await admin.from("gmail_found_invoices").update({
        silent_processed_at: new Date().toISOString(),
        silent_status: "skipped",
        silent_last_error: "no_attachments",
      }).eq("id", row.id);
      continue;
    }
    const used = perMailboxToday.get(row.connection_id) ?? 0;
    if (used >= PER_MAILBOX_DAILY_LIMIT) {
      results.push({ id: row.id, skipped: "per_mailbox_limit" });
      continue;
    }

    const r = await invokeSilent(row.id);
    results.push({ id: row.id, ...r });
    processed++;
    perMailboxToday.set(row.connection_id, used + 1);
    await sleep(MIN_DELAY_MS);
  }

  return json({ ok: true, processed, todayUsed: todayUsed + processed, dailyCap, results });
});

async function invokeSilent(foundInvoiceId: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/parse-invoice-silent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ found_invoice_id: foundInvoiceId }),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function sleep(ms: number) { return new Promise((res) => setTimeout(res, ms)); }
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
