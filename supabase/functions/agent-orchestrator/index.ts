// Agent Orchestrator — single entry point for ALL agent pipeline runs.
//
// Coordinates the 5 existing agents (watchdog, classify, enrich, publish,
// learn) with retry logic and step-level tracking. Does NOT replace any
// existing agent — wraps them.
//
// Body shape:
//   {
//     trigger_type: 'manual' | 'email' | 'scheduled' | 'low_stock' | 'api',
//     user_id?: string,           // required when called with service-role key
//     file_base64?: string,
//     filename?: string,
//     mime_type?: string,
//     supplier_hint?: string,
//     run_id?: string,            // resume an existing run
//   }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

interface StepRecord {
  step: string;
  status: StepStatus;
  retry_count: number;
  error: string | null;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: user JWT OR service-role + X-User-Id ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const sidecarUser = req.headers.get("X-User-Id");
    let userId: string | null = null;

    if (sidecarUser && authHeader === `Bearer ${SERVICE_KEY}`) {
      userId = sidecarUser;
    } else {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) return json({ error: "Not authenticated" }, 401);
      userId = data.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const {
      trigger_type = "manual",
      file_base64,
      filename,
      mime_type,
      supplier_hint,
      run_id: existingRunId,
    } = body ?? {};

    // ── Create or resume agent_runs row ──
    let runId = existingRunId as string | undefined;
    if (!runId) {
      const { data, error } = await admin
        .from("agent_runs")
        .insert({
          user_id: userId,
          trigger_type,
          status: "running",
          invoice_filename: filename ?? null,
          supplier_name: supplier_hint ?? null,
          pipeline_steps: [],
          metadata: { orchestrator: true, trigger_type },
        })
        .select("id")
        .single();
      if (error) throw error;
      runId = data.id;
    }

    console.log(`[orchestrator] run=${runId} trigger=${trigger_type}`);

    // ─────────── STEP 1 — Watchdog (extract) ───────────
    const watchdogResult = await runStep(runId!, "watchdog", 3, async () => {
      const r = await callFunction("agent-watchdog", userId!, {
        trigger_type,
        file_base64,
        file_name: filename,
        mime_type,
        supplier_name: supplier_hint,
      });
      if (!r?.success) throw new Error(r?.error ?? "watchdog returned !success");
      return r;
    });

    if (!watchdogResult) {
      // Cannot proceed without products. Mark run as needs_review and stop.
      await admin
        .from("agent_runs")
        .update({
          status: "awaiting_review",
          human_review_required: true,
          completed_at: new Date().toISOString(),
          error_message: "Watchdog failed after retries",
        })
        .eq("id", runId);
      return json({ run_id: runId, status: "awaiting_review", reason: "watchdog_failed" });
    }

    // Backfill summary on the run row from watchdog response
    await admin
      .from("agent_runs")
      .update({
        supplier_name: watchdogResult.supplier_name ?? supplier_hint ?? null,
        products_extracted: watchdogResult.products_extracted ?? 0,
        products_auto_approved: watchdogResult.products_auto_approved ?? 0,
        products_flagged: watchdogResult.products_flagged ?? 0,
        invoice_id: watchdogResult.invoice_id ?? null,
      })
      .eq("id", runId);

    let productIds: string[] = Array.isArray(watchdogResult.product_ids)
      ? watchdogResult.product_ids
      : [];
    const documentId: string | null = watchdogResult.invoice_id ?? null;

    // Initial supplier name from watchdog (may be refined after classify)
    let supplierName: string | null =
      watchdogResult.supplier_name ?? supplier_hint ?? null;

    // ─────────── STEP 2 — Classify (optional) ───────────
    await runStep(runId!, "classify", 2, async () => {
      if (!file_base64 || !filename) {
        return { skipped: true, reason: "no file content available" };
      }
      const r = await callFunction("classify-extract-validate", userId!, {
        fileContent: file_base64,
        fileName: filename,
        fileType: mime_type,
        supplierName: supplierName,
        invoice_id: documentId,
        user_id: userId,
      });
      return r;
    });

    // ── Resolve product_ids + supplier_name from DB after classify/watchdog ──
    // Guarantees enrich/publish/learn use the freshest values regardless of
    // which step wrote them.
    if (productIds.length === 0) {
      const { data: freshProducts } = await admin
        .from("products")
        .select("id")
        .eq("user_id", userId)
        .eq("source", "invoice_unreviewed")
        .order("updated_at", { ascending: false })
        .limit(50);
      productIds = (freshProducts ?? []).map((p) => p.id as string);
    }

    const { data: updatedRun } = await admin
      .from("agent_runs")
      .select("supplier_name")
      .eq("id", runId)
      .maybeSingle();
    supplierName =
      updatedRun?.supplier_name ??
      watchdogResult.supplier_name ??
      supplier_hint ??
      null;

    // ─────────── STEP 3 — Enrich ───────────
    if (productIds.length > 0) {
      await runStep(runId!, "enrich", 2, async () => {
        const r = await callFunction("auto-enrich", userId!, {
          user_id: userId,
          product_ids: productIds,
          supplier_name: supplierName,
        });
        return r;
      });
    } else {
      await markStep(runId!, "enrich", "skipped", 0, "no products");
    }

    // ─────────── STEP 4 — Publish (if eligible, no retry) ───────────
    let autoPublished = false;
    if (supplierName) {
      const { data: prof } = await admin
        .from("supplier_profiles")
        .select("auto_publish_eligible")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierName)
        .maybeSingle();

      if (prof?.auto_publish_eligible) {
        const result = await runStep(runId!, "publish", 1, async () => {
          const r = await callFunction("publishing-agent", userId!, {
            user_id: userId,
            invoice_id: documentId,
            product_ids: productIds,
          });
          if (!r?.success) throw new Error(r?.error ?? "publish failed");
          return r;
        });
        autoPublished = !!result;
      } else {
        await markStep(runId!, "publish", "skipped", 0, "supplier not auto-publish eligible");
      }
    } else {
      await markStep(runId!, "publish", "skipped", 0, "no supplier");
    }

    // ─────────── STEP 5 — Learn (never blocks) ───────────
    await runStep(runId!, "learn", 1, async () => {
      const r = await callFunction("learning-agent", userId!, {
        user_id: userId,
        supplier_name: supplierName ?? "Unknown",
        document_id: documentId,
        correction_count: 0,
        total_fields: (watchdogResult.products_extracted ?? 0) * 6,
      });
      return r;
    });

    // ─────────── Finalize ───────────
    const finalStatus = autoPublished
      ? "published"
      : watchdogResult.products_flagged > 0
        ? "awaiting_review"
        : "awaiting_review";

    await admin
      .from("agent_runs")
      .update({
        status: finalStatus,
        auto_published: autoPublished,
        human_review_required: !autoPublished,
        completed_at: new Date().toISOString(),
        current_step: null,
      })
      .eq("id", runId);

    return json({
      run_id: runId,
      status: finalStatus,
      auto_published: autoPublished,
      products_extracted: watchdogResult.products_extracted ?? 0,
      products_flagged: watchdogResult.products_flagged ?? 0,
    });
  } catch (err) {
    console.error("[orchestrator] fatal", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────

async function runStep<T>(
  runId: string,
  stepName: string,
  maxRetries: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxRetries) {
    try {
      await markStep(runId, stepName, "running", attempt, null);
      const result = await fn();
      await markStep(runId, stepName, "complete", attempt, null);
      return result;
    } catch (e) {
      lastError = e;
      attempt++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[orchestrator] ${stepName} attempt ${attempt} failed: ${msg}`);
      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  await markStep(runId, stepName, "failed", attempt, errMsg);
  return null;
}

async function markStep(
  runId: string,
  step: string,
  status: StepStatus,
  retryCount: number,
  error: string | null,
) {
  const { data: run } = await admin
    .from("agent_runs")
    .select("pipeline_steps")
    .eq("id", runId)
    .maybeSingle();

  const steps: StepRecord[] = (run?.pipeline_steps as StepRecord[]) ?? [];
  const idx = steps.findIndex((s) => s.step === step);
  const now = new Date().toISOString();

  const stepData: StepRecord = {
    step,
    status,
    retry_count: retryCount,
    error,
    updated_at: now,
    ...(status === "complete" || status === "failed" || status === "skipped"
      ? { completed_at: now }
      : {}),
  };

  if (idx >= 0) {
    steps[idx] = { ...steps[idx], ...stepData };
  } else {
    steps.push({ ...stepData, started_at: now });
  }

  await admin
    .from("agent_runs")
    .update({
      current_step: status === "running" ? step : null,
      pipeline_steps: steps,
      retry_count: retryCount,
    })
    .eq("id", runId);
}

async function callFunction(
  name: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      "X-User-Id": userId,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${name} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json().catch(() => ({}));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
