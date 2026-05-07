// ───────────────────────────────────────────────────────────────
// Agent 2 — Orchestrator
// Runs Stage 1 (classify) → Stage 2 (parse-invoice) → Stage 3 (validate).
// Each stage degrades gracefully — never blocks extraction.
// Also reuses saved supplier_profiles classification when confidence > 70.
// ───────────────────────────────────────────────────────────────
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadSkillsForTask } from "../_shared/claude-skills.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

interface Classification {
  supplier_name: string | null;
  document_type: string;
  currency: string;
  gst_treatment: string;
  layout_pattern: string;
  has_rrp: boolean;
  column_headers: Array<{ label: string; maps_to: string }>;
  confidence: number;
  _source?: "fresh" | "saved";
}

interface PipelineContext {
  body: Record<string, unknown>;
  authHeader: string;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  userId: string | null;
  admin: ReturnType<typeof createClient>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || `Bearer ${anonKey}`;

  try {
    const body = await req.json();
    const fileContent = body?.fileContent;
    const fileName = body?.fileName;

    if (!fileContent || !fileName) {
      return json({ error: "fileContent and fileName are required" }, 400);
    }

    // Resolve user (best-effort) so we can read/write supplier_profiles and create
    // user-owned processing jobs that the phone can poll after returning to the app.
    let userId: string | null = null;
    const sidecarUser = req.headers.get("X-User-Id");
    if (sidecarUser && authHeader === `Bearer ${serviceKey}`) {
      userId = sidecarUser;
    } else {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await userClient.auth.getUser();
        userId = data?.user?.id ?? null;
      } catch { /* anonymous */ }
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const wantsAsync = body?.async === true || body?.asyncMode === true;
    const canRunAsync = wantsAsync && !!userId && typeof EdgeRuntime !== "undefined" && !!EdgeRuntime?.waitUntil;

    if (canRunAsync) {
      const { data: jobRow, error: jobErr } = await admin
        .from("invoice_processing_jobs")
        .insert({
          user_id: userId,
          job_kind: "invoice_read",
          file_name: String(fileName),
          status: "running",
          started_at: new Date().toISOString(),
          request_payload: {
            fileName: String(fileName),
            fileType: body?.fileType ?? null,
            supplierName: body?.supplierName ?? null,
            detailedMode: body?.detailedMode === true,
          },
        })
        .select("id")
        .single();

      if (!jobErr && jobRow?.id) {
        const jobId = jobRow.id as string;
        console.log(`[classify-extract-validate] async invoice_read job ${jobId} started`);

        // Heartbeat so the client poller can detect a silently-dead worker
        // (e.g. platform killed the isolate past its wall-clock budget).
        // We bump `started_at` every 20s while running. The client treats
        // a "running" row whose started_at is older than ~90s as stalled.
        const heartbeat = setInterval(() => {
          admin.from("invoice_processing_jobs")
            .update({ started_at: new Date().toISOString() })
            .eq("id", jobId)
            .then(() => {}, () => {});
        }, 20_000);

        // Self-imposed deadline. The platform will kill the isolate well
        // before infinity — racing against an explicit timeout lets us
        // mark the job failed instead of leaving the row "running".
        const HARD_DEADLINE_MS = 240_000; // 4 min — keeps us under the platform cap
        const deadline = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `Reader exceeded ${HARD_DEADLINE_MS / 1000}s — invoice is too large or complex for one pass. Try splitting the PDF or uploading just the invoice page.`,
          )), HARD_DEADLINE_MS),
        );

        const work = (async () => {
          try {
            const result = await Promise.race([
              runPipeline({ body, authHeader, supabaseUrl, serviceKey, anonKey, userId, admin }),
              deadline,
            ]);
            clearInterval(heartbeat);
            await admin.from("invoice_processing_jobs").update({
              status: "done",
              result,
              completed_at: new Date().toISOString(),
            }).eq("id", jobId);
            console.log(`[classify-extract-validate] async invoice_read job ${jobId} complete`);
          } catch (err) {
            clearInterval(heartbeat);
            console.error(`[classify-extract-validate] async invoice_read job ${jobId} failed:`, err);
            await admin.from("invoice_processing_jobs").update({
              status: "failed",
              error_message: err instanceof Error ? err.message : String(err),
              completed_at: new Date().toISOString(),
            }).eq("id", jobId);
          }
        })();

        EdgeRuntime.waitUntil(work);
        return json({ job_id: jobId, status: "running", async: true }, 202);
      }

      console.warn("[classify-extract-validate] async job creation failed; falling back to synchronous run", jobErr);
    }

    const result = await runPipeline({ body, authHeader, supabaseUrl, serviceKey, anonKey, userId, admin });
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("classify-extract-validate error:", err);
    return json({ error: err instanceof Error ? err.message : "Pipeline failed" }, 500);
  }
});

async function runPipeline(ctx: PipelineContext): Promise<Record<string, unknown>> {
  const {
    body,
    authHeader,
    supabaseUrl,
    serviceKey,
    anonKey,
    userId,
    admin,
  } = ctx;

  const {
    fileContent,
    fileName,
    fileType,
    supplierName,
    // Forward-passthrough of every other parse-invoice option
    async: _async,
    asyncMode: _asyncMode,
    ...rest
  } = body ?? {};

  // ─────── STAGE 1 — orientation ───────
  let classification: Classification | null = null;
  let usedSavedProfile = false;
  const SAVED_PROFILE_MIN_CONFIDENCE = 20; // lowered from 70 — raise to 70 once 7+ invoices/supplier

  // First try: saved profile by supplier hint OR filename token match.
  // We track WHICH signal matched so we can later detect filename-driven
  // misclassification (e.g. "Sea Level Lost Paradise.pdf" is actually Bond-Eye).
  const hintSupplier = String(supplierName || "").trim();
  let savedProfileMatchSource: "hint" | "filename" | null = null;
  let filenameSupplierGuess: string | null = null;

  if (userId) {
    try {
      // Pull all candidate profiles meeting the confidence floor (cap 50 to be safe)
      const { data: profiles } = await admin
        .from("supplier_profiles")
        .select("supplier_name, profile_data, confidence_score, currency")
        .eq("user_id", userId)
        .gte("confidence_score", SAVED_PROFILE_MIN_CONFIDENCE)
        .limit(50);

      const fileLower = String(fileName || "").toLowerCase();

      // Step A — try the supplier hint first (explicit user/UI input).
      let matched = (profiles || []).find((p) => {
        const sName = (p.supplier_name || "").toLowerCase().trim();
        if (!sName || !hintSupplier) return false;
        return sName === hintSupplier.toLowerCase()
          || sName.includes(hintSupplier.toLowerCase())
          || hintSupplier.toLowerCase().includes(sName);
      });
      if (matched) savedProfileMatchSource = "hint";

      // Step B — fall back to filename token match, but REMEMBER it was
      // filename-only so we can verify against invoice content later.
      if (!matched) {
        matched = (profiles || []).find((p) => {
          const sName = (p.supplier_name || "").toLowerCase().trim();
          if (!sName) return false;
          return fileLower.includes(sName);
        });
        if (matched) {
          savedProfileMatchSource = "filename";
          filenameSupplierGuess = matched.supplier_name;
        }
      }

      const saved = matched?.profile_data?.classification as Classification | undefined;
      if (matched && saved) {
        // CRITICAL: when the match came from the filename only (not a hint
        // and not yet verified against invoice content), we still kick off
        // the orientation agent so it can override with the true supplier
        // detected from header/ABN/SKU prefix/bank details. Filenames are
        // unreliable (collection names, generic words like "Sea Level").
        if (savedProfileMatchSource === "filename") {
          console.log(`[classify-extract-validate] Filename hints "${matched.supplier_name}" — will verify against invoice content`);
          // Do NOT short-circuit; let Stage 1 orientation run and
          // override if it disagrees.
        } else {
          classification = { ...saved, _source: "saved", supplier_name: matched.supplier_name };
          usedSavedProfile = true;
          console.log(`[classify-extract-validate] Reusing saved classification for ${matched.supplier_name} (confidence ${matched.confidence_score})`);
        }
      }
    } catch (e) {
      console.warn("[classify-extract-validate] saved-profile lookup failed:", e);
    }
  }

  // Otherwise call the orientation agent
  if (!classification) {
    try {
      const cls = await fetch(`${supabaseUrl}/functions/v1/classify-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ file_base64: fileContent, filename: fileName, fileType }),
      });
      if (cls.ok) {
        const j = await cls.json();
        classification = { ...j.classification, _source: "fresh" } as Classification;
      } else {
        console.warn("[classify-extract-validate] Stage 1 failed:", cls.status, await cls.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("[classify-extract-validate] Stage 1 errored:", e);
    }
  }

  // ─────── STAGE 1B — Filename-vs-content supplier mismatch detection ───────
  // Some invoices are named after a collection or product line ("Sea Level
  // Lost Paradise.pdf") but are actually issued by a different parent brand
  // (Bond-Eye Australia). Stage 1 reads letterhead / ABN / bank details to
  // determine the TRUE supplier — we now compare that to whatever the filename
  // suggests, log a misclassification alert if they differ, and surface it to
  // the review UI.
  let filenameMismatch: {
    detected: boolean;
    filename: string;
    expected_from_filename: string;
    detected_supplier: string;
    alert_id: string | null;
  } | null = null;

  try {
    const detectedSupplier = classification?.supplier_name || null;
    const fileLower = String(fileName || "").toLowerCase();

    let guess = filenameSupplierGuess;
    if (!guess && userId && detectedSupplier) {
      try {
        const { data: allProfiles } = await admin
          .from("supplier_profiles")
          .select("supplier_name")
          .eq("user_id", userId)
          .limit(200);
        const detectedLower = detectedSupplier.toLowerCase().trim();
        const candidate = (allProfiles ?? []).find((p) => {
          const sName = (p.supplier_name || "").toLowerCase().trim();
          if (!sName) return false;
          if (sName === detectedLower) return false;
          if (sName.length < 4) return false; // skip "s", "j", "el" — would false-positive
          return fileLower.includes(sName);
        });
        if (candidate) guess = candidate.supplier_name;
      } catch (_e) { /* best-effort */ }
    }

    const norm = (s: string) =>
      s.toLowerCase()
        .replace(/\b(pty|ltd|inc|llc|gmbh|australia|au|aus)\b/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();

    if (
      detectedSupplier &&
      guess &&
      norm(detectedSupplier) !== norm(guess) &&
      !norm(detectedSupplier).includes(norm(guess)) &&
      !norm(guess).includes(norm(detectedSupplier))
    ) {
      console.warn(
        `[classify-extract-validate] FILENAME MISMATCH: file "${fileName}" suggests "${guess}" but content says "${detectedSupplier}"`,
      );

      let alertId: string | null = null;
      if (userId) {
        try {
          const { data: alertRow } = await admin
            .from("misclassification_alerts")
            .insert({
              user_id: userId,
              filename: String(fileName),
              detected_supplier: detectedSupplier,
              expected_from_filename: guess,
            })
            .select("id")
            .maybeSingle();
          alertId = alertRow?.id ?? null;
        } catch (e) {
          console.warn("[classify-extract-validate] alert insert failed:", e);
        }
      }

      filenameMismatch = {
        detected: true,
        filename: String(fileName),
        expected_from_filename: guess,
        detected_supplier: detectedSupplier,
        alert_id: alertId,
      };
    }
  } catch (e) {
    console.warn("[classify-extract-validate] mismatch detection failed:", e);
  }

  // ─────── STAGE 2 — extraction ───────
  // Look up the user-edited "Extraction Skills" file(s) for this supplier.
  //
  // MULTI-BRAND DISTRIBUTOR SUPPORT:
  //   Some "suppliers" on the invoice are actually distributors that carry
  //   multiple brands (e.g. Function Design Group → Lulalife + Rubyyaya;
  //   HEAD Oceania → Zoggs; Senses Accessories → Italian Cartel). In that
  //   case we load EVERY mapped brand's skill file and concatenate them so
  //   the extractor sees rules for all possible brands on the invoice.
  let supplierSkillsMarkdown: string | null = null;
  let distributorMatch: {
    company_name: string;
    brands_loaded: string[];
    skill_files_loaded: number;
  } | null = null;
  const detectedSupplierForSkills = classification?.supplier_name || supplierName || null;

  if (userId && detectedSupplierForSkills) {
    try {
      // Step 1 — is this a known multi-brand distributor?
      const detectedLower = String(detectedSupplierForSkills).toLowerCase().trim();
      const { data: mbRows } = await admin
        .from("multi_brand_suppliers")
        .select("invoice_company_name, brand_rules")
        .eq("user_id", userId);

      const distributor = (mbRows ?? []).find((r: any) => {
        const name = String(r.invoice_company_name || "").toLowerCase().trim();
        if (!name) return false;
        return detectedLower === name
          || detectedLower.includes(name)
          || name.includes(detectedLower);
      });

      // Build the list of supplier_skills rows to load.
      const skillTargets: string[] = [];
      if (distributor && Array.isArray(distributor.brand_rules)) {
        const brands = Array.from(
          new Set(
            (distributor.brand_rules as any[])
              .map((r) => String(r?.brand || "").trim())
              .filter((b) => b.length > 0),
          ),
        );
        skillTargets.push(...brands);
        // Also try the distributor's own name (in case they have their own skill file)
        skillTargets.push(distributor.invoice_company_name);
        console.log(
          `[classify-extract-validate] Distributor "${distributor.invoice_company_name}" → loading skills for: ${brands.join(", ")}`,
        );
      } else {
        skillTargets.push(detectedSupplierForSkills);
      }

      // Step 2 — load every targeted skill file in parallel
      const loaded: { name: string; markdown: string }[] = [];
      await Promise.all(
        skillTargets.map(async (name) => {
          try {
            const { data: skills } = await admin
              .from("supplier_skills")
              .select("skills_markdown")
              .eq("user_id", userId)
              .ilike("supplier_name", name)
              .maybeSingle();
            const md = String(skills?.skills_markdown || "").trim();
            if (md.length > 0) loaded.push({ name, markdown: md });
          } catch (_e) { /* best-effort per-brand */ }
        }),
      );

      if (loaded.length > 0) {
        supplierSkillsMarkdown = loaded
          .map((l) => `## Brand: ${l.name}\n\n${l.markdown}`)
          .join("\n\n---\n\n");
        console.log(
          `[classify-extract-validate] Loaded ${loaded.length} supplier skill file(s) (${supplierSkillsMarkdown.length} chars)`,
        );
      }

      if (distributor && loaded.length > 0) {
        distributorMatch = {
          company_name: distributor.invoice_company_name,
          brands_loaded: loaded.map((l) => l.name),
          skill_files_loaded: loaded.length,
        };
      }
    } catch (e) {
      console.warn("[classify-extract-validate] supplier_skills lookup failed:", e);
    }
  }

  // ─────── Load Claude Skills Library (base + extraction + per-supplier) ───────
  // These are user-curated markdown files from the `claude_skills` table.
  // Cascade order: fashion-retail → extraction → supplier-<name>.
  let claudeSkillsMarkdown = "";
  try {
    claudeSkillsMarkdown = await loadSkillsForTask(
      userId,
      "extraction",
      detectedSupplierForSkills,
    );
    if (claudeSkillsMarkdown) {
      console.log(`[classify-extract-validate] Loaded Claude skills (${claudeSkillsMarkdown.length} chars)`);
    }
  } catch (e) {
    console.warn("[classify-extract-validate] claude_skills lookup failed:", e);
  }

  // Merge Claude Skills + per-supplier Extraction Skills into the single
  // markdown block parse-invoice already injects at the top of the prompt.
  const mergedSkills = [claudeSkillsMarkdown, supplierSkillsMarkdown]
    .filter((s) => s && String(s).trim().length > 0)
    .join("\n\n---\n\n");

  const parseBody = {
    ...rest,
    fileContent,
    fileName,
    fileType,
    supplierName: supplierName || classification?.supplier_name || undefined,
    invoice_classification: classification ?? undefined,
    supplierSkillsMarkdown: mergedSkills.length > 0 ? mergedSkills : undefined,
  };

  // ─────── STAGE 2A — Azure Document Intelligence Layout (PDF only) ───────
  // Two-stage hybrid: Azure gets every table cell with row/col preserved,
  // then an LLM interprets the structured grid (no table-structure guessing).
  let extraction: Record<string, unknown> | null = null;
  let azureUsed = false;

  const isPdf = String(fileType || "").toLowerCase() === "pdf" ||
    String(fileName || "").toLowerCase().endsWith(".pdf");
  const hasAzure = !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY") &&
    !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");

  if (isPdf && hasAzure) {
    try {
      const az = await fetch(`${supabaseUrl}/functions/v1/azure-table-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          fileContent,
          fileName,
          fileType,
          supplierName: supplierName || classification?.supplier_name || undefined,
        }),
      });
      if (az.ok) {
        const azJson = await az.json();
        const azProducts = Array.isArray(azJson?.products) ? azJson.products : [];
        if (azProducts.length > 0) {
          console.log(`[classify-extract-validate] Azure layout returned ${azProducts.length} line items in ${azJson.azure_ms}ms`);
          extraction = {
            products: azProducts,
            supplier: supplierName || classification?.supplier_name || null,
            extractor: "azure_layout+llm",
            tables_found: azJson.tables_found,
            azure_raw_tables: azJson.raw_tables ?? [],
          };
          azureUsed = true;
        } else {
          console.warn("[classify-extract-validate] Azure returned 0 products, falling back to parse-invoice");
        }
      } else {
        console.warn("[classify-extract-validate] Azure call failed:", az.status, await az.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("[classify-extract-validate] Azure errored, falling back:", e);
    }
  }

  // ─────── STAGE 2B — Fallback / non-PDF — original parse-invoice agent ───────
  if (!extraction) {
    const ext = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
      body: JSON.stringify(parseBody),
    });

    if (!ext.ok) {
      const errText = await ext.text();
      const err = new Error(`Extraction failed (${ext.status}): ${errText.slice(0, 500)}`);
      (err as Error & { status?: number }).status = ext.status;
      throw err;
    }
    extraction = await ext.json();
  }

  // ─────── STAGE 3 — validation ───────
  let validatedProducts = extraction?.products ?? [];
  let validationSummary: { total: number; flagged: number; flag_types: Record<string, number> } | null = null;

  try {
    const v = await fetch(`${supabaseUrl}/functions/v1/validate-extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        products: validatedProducts,
        classification,
        supplier_name: classification?.supplier_name || supplierName || null,
      }),
    });
    if (v.ok) {
      const j = await v.json();
      validatedProducts = j.products;
      validationSummary = j.summary;
    } else {
      console.warn("[classify-extract-validate] Stage 3 failed:", v.status);
    }
  } catch (e) {
    console.warn("[classify-extract-validate] Stage 3 errored:", e);
  }

  // ─────── STAGE 3B — Multi-brand split (per-line vendor by SKU prefix) ───────
  let multiBrandSplit: {
    applied: boolean;
    company_name: string | null;
    rules: Array<{ sku_prefix: string; brand: string }>;
    counts: Record<string, number>;
  } = { applied: false, company_name: null, rules: [], counts: {} };

  try {
    const detectedCompany =
      classification?.supplier_name || extraction?.supplier || supplierName || null;
    if (userId && detectedCompany) {
      const { data: mbRows } = await admin
        .from("multi_brand_suppliers")
        .select("invoice_company_name, brand_rules")
        .eq("user_id", userId);

      const lc = detectedCompany.toLowerCase();
      const match = (mbRows ?? []).find((r: any) => {
        const name = String(r.invoice_company_name || "").toLowerCase();
        return name && (lc.includes(name) || name.includes(lc));
      });

      if (match && Array.isArray(match.brand_rules) && match.brand_rules.length > 0) {
        const rules = (match.brand_rules as any[])
          .filter((r) => r && typeof r.sku_prefix === "string" && typeof r.brand === "string")
          .map((r) => ({ sku_prefix: String(r.sku_prefix).toUpperCase(), brand: String(r.brand) }))
          // Longest prefix wins so "FKT" beats "F" if both existed
          .sort((a, b) => b.sku_prefix.length - a.sku_prefix.length);

        const counts: Record<string, number> = {};
        for (const item of validatedProducts as any[]) {
          const sku = String(item?.sku ?? item?.SKU ?? "").toUpperCase();
          if (!sku) continue;
          const rule = rules.find((r) => sku.startsWith(r.sku_prefix));
          if (rule) {
            item.vendor = rule.brand;
            item.brand = rule.brand;
            counts[rule.brand] = (counts[rule.brand] || 0) + 1;
          }
        }

        multiBrandSplit = {
          applied: Object.keys(counts).length > 0,
          company_name: match.invoice_company_name,
          rules,
          counts,
        };
        console.log(
          `[classify-extract-validate] multi-brand split for "${detectedCompany}":`,
          JSON.stringify(counts),
        );
      }
    }
  } catch (e) {
    console.warn("[classify-extract-validate] multi-brand split failed:", e);
  }

  // ─────── Persist classification to supplier_profiles ───────
  const supplierFinal = classification?.supplier_name || extraction?.supplier || supplierName || null;
  if (userId && classification && !usedSavedProfile && supplierFinal) {
    try {
      // Read existing profile_data so we don't clobber it
      const { data: existing } = await admin
        .from("supplier_profiles")
        .select("id, profile_data")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierFinal)
        .maybeSingle();

      const mergedProfileData = {
        ...(existing?.profile_data ?? {}),
        classification: {
          supplier_name: supplierFinal,
          document_type: classification.document_type,
          currency: classification.currency,
          gst_treatment: classification.gst_treatment,
          layout_pattern: classification.layout_pattern,
          has_rrp: classification.has_rrp,
          column_headers: classification.column_headers,
          confidence: classification.confidence,
          updated_at: new Date().toISOString(),
        },
      };

      await admin.from("supplier_profiles").upsert({
        user_id: userId,
        supplier_name: supplierFinal,
        profile_data: mergedProfileData,
        currency: classification.currency,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,supplier_name" });
    } catch (e) {
      console.warn("[classify-extract-validate] supplier_profiles upsert failed:", e);
    }
  }

  return {
    ...extraction,
    products: validatedProducts,
    classification,
    classification_source: classification?._source ?? "missing",
    extractor_used: azureUsed ? "azure_layout+llm" : "parse-invoice",
    validation_summary: validationSummary,
    multi_brand_split: multiBrandSplit,
    filename_mismatch: filenameMismatch,
    distributor_match: distributorMatch,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
