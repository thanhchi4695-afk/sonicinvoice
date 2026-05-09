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

  console.log("[startup] ANTHROPIC_API_KEY present:", !!Deno.env.get("ANTHROPIC_API_KEY"));
  try {
    console.log("[startup] Deno.env keys available:", Object.keys(Deno.env.toObject()).join(", "));
  } catch (e) {
    console.log("[startup] Deno.env.toObject() failed:", e instanceof Error ? e.message : String(e));
  }

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
              grader_result: (result as Record<string, unknown>)?.grader_result ?? null,
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
    fileBase64: fileContent,
    fileName,
    filename: fileName,
    fileType,
    mimeType: fileType,
    supplierName: supplierName || classification?.supplier_name || undefined,
    invoice_classification: classification ?? undefined,
    supplierSkillsMarkdown: mergedSkills.length > 0 ? mergedSkills : undefined,
  };

  // ─────── STAGE 2A — Azure Document Intelligence Layout (PDF only) ───────
  // Two-stage hybrid: Azure gets every table cell with row/col preserved,
  // then an LLM interprets the structured grid (no table-structure guessing).
  let extraction: Record<string, unknown> | null = null;
  let azureUsed = false;

  const mt = String(fileType || "").toLowerCase();
  const isPdf =
    mt === "pdf" ||
    mt === "application/pdf" ||
    mt === "application/octet-stream" ||
    String(fileName || "").toLowerCase().endsWith(".pdf");
  const hasAzure = !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY") &&
    !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const hasAnthropic = !!Deno.env.get("ANTHROPIC_API_KEY");
  // Prefer Claude-native PDF parsing when the key is present — Azure is only
  // used as a fallback for PDFs when ANTHROPIC_API_KEY is missing.
  const preferClaudePdf = isPdf && hasAnthropic;
  console.log(
    `[route] isPdf=${isPdf} hasAnthropic=${hasAnthropic} hasAzure=${hasAzure} preferClaudePdf=${preferClaudePdf} fileName=${fileName} fileType=${fileType}`,
  );

  if (isPdf && hasAzure && !preferClaudePdf) {
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
        const azProductsRaw = Array.isArray(azJson?.products) ? azJson.products : [];
        // Normalise Azure output → internal product shape.
        // Bond Eye–style flat lists give us RRP directly, so we surface it as both
        // `rrp` and `compare_at_price` so the Shopify CSV gets a Compare At Price
        // without needing Phase 3 price research.
        const azProducts = azProductsRaw.map((p: Record<string, unknown>) => {
          const cost = Number(p.unit_cost ?? p.cost ?? 0) || 0;
          const rrp = p.rrp != null && p.rrp !== "" ? Number(p.rrp) : null;
          const qty = Number(p.qty ?? p.quantity ?? 0) || 0;
          // Azure flat-list output uses product_title/style_code; the rest of the
          // pipeline (validator, UI, Shopify CSV) expects name/sku. Surface both.
          const name = String(p.product_title ?? p.name ?? "").trim();
          const sku = String(p.style_code ?? p.sku ?? "").trim();
          const colour = String(p.colour ?? p.color ?? "").trim();
          const size = String(p.size ?? "").trim();
          const category = String(p.category ?? "").trim();
          return {
            ...p,
            name,
            product_name: name,
            product_title: name,
            sku,
            style_code: sku,
            colour,
            size,
            qty,
            quantity: qty,
            cost,
            unit_cost: cost,
            rrp: rrp ?? null,
            compare_at_price: rrp ?? null,
            // Carry section header (e.g. "Recycled", "Eco") as a tag candidate.
            tags: category ? [category] : (Array.isArray(p.tags) ? p.tags : []),
          };
        });
        if (azProducts.length > 0) {
          console.log(`[classify-extract-validate] Azure layout returned ${azProducts.length} line items in ${azJson.azure_ms}ms (format=${azJson.format ?? "unknown"})`);
          extraction = {
            products: azProducts,
            supplier: supplierName || classification?.supplier_name || null,
            extractor: "azure_layout+llm",
            tables_found: azJson.tables_found,
            azure_raw_tables: azJson.raw_tables ?? [],
            invoice_format: azJson.format ?? null,
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

  // ─────── STAGE 2B — Claude-PDF direct (Anthropic native) or parse-invoice fallback ───────
  let claudePdfUsed = false;
  let claudeInvoiceSubtotal: number | null = null;
  let graderResult: GraderResult | null = null;
  let graderAttempts = 0;

  if (!extraction && preferClaudePdf) {
    try {
      const first = await runClaudePdfDirect({
        fileBase64: String(fileContent),
        supplierName: supplierName || classification?.supplier_name || null,
        skillsMarkdown: mergedSkills,
      });
      let claudeProducts = applyStaticVendorRouting(first.products);
      claudeInvoiceSubtotal = first.invoice_subtotal;
      claudePdfUsed = true;
      console.log(`[claude-pdf] success: ${claudeProducts.length} products, subtotal=${claudeInvoiceSubtotal}`);

      // Grader loop — max 2 re-extraction attempts.
      const MAX_REEXTRACT = 2;
      for (let attempt = 1; attempt <= MAX_REEXTRACT + 1; attempt++) {
        graderAttempts = attempt;
        graderResult = await runSonicGrader({
          products: claudeProducts,
          invoice_subtotal: claudeInvoiceSubtotal,
          supplier_hint: supplierName || classification?.supplier_name || null,
        });
        console.log(
          `[grader] attempt=${attempt} score=${graderResult.score} passed=${graderResult.passed} reextract=${graderResult.reextract_needed}`,
        );
        if (!graderResult.reextract_needed || attempt > MAX_REEXTRACT) break;
        try {
          const retry = await runClaudePdfDirect({
            fileBase64: String(fileContent),
            supplierName: supplierName || classification?.supplier_name || null,
            skillsMarkdown: mergedSkills,
            reextractReason: graderResult.reextract_reason,
          });
          claudeProducts = retry.products;
          if (retry.invoice_subtotal != null) claudeInvoiceSubtotal = retry.invoice_subtotal;
          console.log(`[claude-pdf] re-extract attempt ${attempt} → ${claudeProducts.length} products`);
        } catch (retryErr) {
          console.warn(`[claude-pdf] re-extract attempt ${attempt} failed:`, retryErr);
          break;
        }
      }
      if (graderResult) graderResult.attempts = graderAttempts;

      extraction = {
        products: claudeProducts,
        supplier: supplierName || classification?.supplier_name || null,
        extractor: "claude-pdf",
        invoice_subtotal: claudeInvoiceSubtotal,
      };
    } catch (e) {
      console.error("[claude-pdf] failed:", e instanceof Error ? e.message : String(e));
      claudePdfUsed = false;
      // Fall through to Azure (if available) or parse-invoice
      if (isPdf && hasAzure) {
        try {
          console.log("[claude-pdf] falling back to Azure layout");
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
            const azProductsRaw = Array.isArray(azJson?.products) ? azJson.products : [];
            const azProducts = azProductsRaw.map((p: Record<string, unknown>) => {
              const cost = Number(p.unit_cost ?? p.cost ?? 0) || 0;
              const rrp = p.rrp != null && p.rrp !== "" ? Number(p.rrp) : null;
              const qty = Number(p.qty ?? p.quantity ?? 0) || 0;
              const name = String(p.product_title ?? p.name ?? "").trim();
              const sku = String(p.style_code ?? p.sku ?? "").trim();
              const colour = String(p.colour ?? p.color ?? "").trim();
              const size = String(p.size ?? "").trim();
              const category = String(p.category ?? "").trim();
              return {
                ...p, name, product_name: name, product_title: name,
                sku, style_code: sku, colour, size, qty, quantity: qty,
                cost, unit_cost: cost, rrp: rrp ?? null, compare_at_price: rrp ?? null,
                tags: category ? [category] : (Array.isArray(p.tags) ? p.tags : []),
              };
            });
            if (azProducts.length > 0) {
              extraction = {
                products: azProducts,
                supplier: supplierName || classification?.supplier_name || null,
                extractor: "azure_layout+llm",
                tables_found: azJson.tables_found,
                azure_raw_tables: azJson.raw_tables ?? [],
                invoice_format: azJson.format ?? null,
              };
              azureUsed = true;
            }
          }
        } catch (azErr) {
          console.warn("[claude-pdf] Azure fallback also failed:", azErr);
        }
      }
    }
  }

  if (!extraction) {
    try {
      const ext = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
        body: JSON.stringify(parseBody),
      });

      if (!ext.ok) {
        const errText = await ext.text();
        throw new Error(`Extraction failed (${ext.status}): ${errText.slice(0, 500)}`);
      }
      extraction = await ext.json();
    } catch (e) {
      throw e;
    }
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

  // ─────── STAGE 3C — Sonic Outcomes Grader (single-pass for non-claude paths) ───────
  // Claude-PDF runs the grader inline with its re-extract loop. For Azure /
  // parse-invoice we still grade once (post multi-brand split so vendor checks work).
  if (!graderResult && validatedProducts.length > 0 && Deno.env.get("ANTHROPIC_API_KEY")) {
    try {
      graderResult = await runSonicGrader({
        products: validatedProducts as Array<Record<string, unknown>>,
        invoice_subtotal: claudeInvoiceSubtotal,
        supplier_hint: classification?.supplier_name || supplierName || null,
      });
      graderAttempts = 1;
      graderResult.attempts = 1;
      console.log(`[grader] (post-extract) score=${graderResult.score} passed=${graderResult.passed}`);
    } catch (e) {
      console.warn("[grader] post-extract grade failed:", e);
    }
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
    extractor_used: azureUsed ? "azure_layout+llm" : (claudePdfUsed ? "claude-pdf" : "parse-invoice"),
    validation_summary: validationSummary,
    multi_brand_split: multiBrandSplit,
    filename_mismatch: filenameMismatch,
    distributor_match: distributorMatch,
    grader_result: graderResult,
    invoice_subtotal: claudeInvoiceSubtotal,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─────── Claude-native PDF extraction (Anthropic API direct) ───────
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

const RETURN_INVOICE_TOOL = {
  name: "return_invoice",
  description: "Return all line items extracted from the invoice PDF.",
  input_schema: {
    type: "object",
    properties: {
      invoice_subtotal: {
        type: ["number", "null"],
        description: "Invoice subtotal ex-GST printed on the document. null if not visible.",
      },
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Product/style name" },
            sku: { type: "string", description: "Style code / SKU" },
            colour: { type: "string" },
            size: { type: "string" },
            qty: { type: "number" },
            cost: { type: "number", description: "Unit cost ex-tax" },
            rrp: { type: ["number", "null"] },
            barcode: { type: ["string", "null"] },
            category: { type: ["string", "null"], description: "Section header e.g. Eco, Recycled" },
          },
          required: ["name", "sku", "qty", "cost"],
        },
      },
    },
    required: ["products"],
  },
} as const;

async function runClaudePdfDirect(opts: {
  fileBase64: string;
  supplierName: string | null;
  skillsMarkdown: string;
  reextractReason?: string | null;
}): Promise<{ products: Array<Record<string, unknown>>; invoice_subtotal: number | null }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const systemPrompt = [
    "You are an expert invoice/packing-slip extractor for fashion wholesale documents.",
    "Extract EVERY line item. Preserve every variant (colour + size combo) as its own row.",
    "Numbers must be plain numbers (no currency symbols). Use null when truly unknown.",
    "Carry section headers (e.g. 'Eco', 'Recycled') across page breaks as `category`.",
    "Also return the invoice subtotal ex-GST as `invoice_subtotal` (null if not printed).",
    opts.supplierName ? `Supplier: ${opts.supplierName}` : "",
    opts.skillsMarkdown ? `\n\nSupplier-specific extraction rules:\n${opts.skillsMarkdown}` : "",
    opts.reextractReason
      ? `\n\nIMPORTANT — RE-EXTRACTION FEEDBACK FROM GRADER:\n${opts.reextractReason}\nFix these specific issues this time.`
      : "",
  ].filter(Boolean).join("\n");

  const userPrompt = "Extract all product line items from this invoice PDF using the return_invoice tool.";

  const fileBase64 = String(opts.fileBase64 || "").replace(/^data:[^;]+;base64,/, "");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      tools: [RETURN_INVOICE_TOOL],
      tool_choice: { type: "tool", name: "return_invoice" },
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
          },
          { type: "text", text: userPrompt },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  const toolUse = (data?.content || []).find((b: Record<string, unknown>) => b.type === "tool_use");
  if (!toolUse || !toolUse.input) {
    throw new Error("Anthropic returned no tool_use block");
  }
  const rawProducts = Array.isArray(toolUse.input.products) ? toolUse.input.products : [];
  const subtotalRaw = toolUse.input.invoice_subtotal;
  const invoice_subtotal = subtotalRaw == null || subtotalRaw === "" ? null : Number(subtotalRaw);

  const products = rawProducts.map((p: Record<string, unknown>) => {
    const cost = Number(p.cost ?? 0) || 0;
    const rrp = p.rrp != null && p.rrp !== "" ? Number(p.rrp) : null;
    const qty = Number(p.qty ?? 0) || 0;
    const name = String(p.name ?? "").trim();
    const sku = String(p.sku ?? "").trim();
    const colour = String(p.colour ?? "").trim();
    const size = String(p.size ?? "").trim();
    const category = String(p.category ?? "").trim();
    return {
      name, product_name: name, product_title: name,
      sku, style_code: sku, colour, size, qty, quantity: qty,
      cost, unit_cost: cost, rrp, compare_at_price: rrp,
      barcode: p.barcode ?? null,
      tags: category ? [category] : [],
    };
  });

  return { products, invoice_subtotal: Number.isFinite(invoice_subtotal as number) ? (invoice_subtotal as number) : null };
}

// ─────── Sonic Outcomes Grader (Claude Haiku 4.5) ───────
const SONIC_GRADER_MODEL = "claude-haiku-4-5-20251001";

const SONIC_OUTCOMES_RUBRIC = `
You are a grader evaluating an invoice extraction for Splash Swimwear.
Score the extraction and return JSON only.

RUBRIC — check every criterion:

1. COMPLETENESS: Does product count match the expected line items?
   (hint: check against the invoice subtotal — if sum(cost×qty) ≈ subtotal, count is likely correct)

2. NO_BLANK_COLOURS: Every product must have a colour value.
   Blank, null, "Unknown", or "Not Specified" = fail this criterion.

3. NO_BLANK_SIZES: Every product must have a size value.
   Blank or null = fail. "One Size" is valid.

4. VENDOR_FROM_SKU: Vendor must come from SKU prefix routing, not the invoice header.
   BOUND* = Bond Eye, SL* = Sea Level, AT*ND = Artesands, AT*GA = Bond Eye Aria.
   If vendor matches the raw invoice header string (e.g. "Bond-Eye Australia") = fail.

5. NO_TESTER_ROWS: No rows where SKU starts with TEST or RRP = 0.

6. COST_VALIDATES: sum(cost_ex_gst × qty) must equal invoice subtotal ±$1.00.
   If subtotal unknown, mark as "unverified" not fail.

7. RRP_ABOVE_COST: For every product, check: rrp_incl_gst > (cost_ex_gst × 1.1).
   This verifies RRP covers cost plus GST with any margin above zero.
   Example: cost=$76.90, cost×1.1=$84.59, rrp=$180.00 → $180 > $84.59 → PASS.
   Only fail if rrp_incl_gst is actually lower than cost_ex_gst × 1.1
   (i.e. selling below cost after GST). Do not compute gross margin percentage.
   Do not apply any percentage threshold. The check is purely: rrp > cost × 1.1.
   If rrp_incl_gst is missing/null for a product, mark this criterion "unverified" not "fail".

Return this exact JSON:
{
  "passed": true | false,
  "score": 0-100,
  "criteria": {
    "completeness": "pass" | "fail" | "unverified",
    "no_blank_colours": "pass" | "fail",
    "no_blank_sizes": "pass" | "fail",
    "vendor_from_sku": "pass" | "fail" | "unverified",
    "no_tester_rows": "pass" | "fail",
    "cost_validates": "pass" | "fail" | "unverified",
    "rrp_above_cost": "pass" | "fail"
  },
  "failures": ["list of specific failures with product names"],
  "reextract_needed": true | false,
  "reextract_reason": "specific instruction for what to fix on re-extraction"
}

If reextract_needed is true, the agent will re-run extraction with your reextract_reason
appended to the system prompt. Be specific — name the exact products and fields that failed.
`.trim();

export interface GraderResult {
  passed: boolean;
  score: number;
  criteria: Record<string, "pass" | "fail" | "unverified">;
  failures: string[];
  reextract_needed: boolean;
  reextract_reason: string;
  attempts?: number;
  error?: string;
}

async function runSonicGrader(opts: {
  products: Array<Record<string, unknown>>;
  invoice_subtotal: number | null;
  supplier_hint: string | null;
}): Promise<GraderResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      passed: false, score: 0, criteria: {}, failures: ["ANTHROPIC_API_KEY not set"],
      reextract_needed: false, reextract_reason: "", error: "missing_key",
    };
  }

  // Trim products to fields the grader needs (keeps token cost down).
  const slim = opts.products.map((p) => ({
    name: p.name ?? p.product_name ?? null,
    sku: p.sku ?? p.style_code ?? null,
    vendor: p.vendor ?? p.brand ?? null,
    colour: p.colour ?? p.color ?? null,
    size: p.size ?? null,
    qty: p.qty ?? p.quantity ?? null,
    cost_ex_gst: p.cost ?? p.unit_cost ?? null,
    rrp_incl_gst: p.rrp ?? p.compare_at_price ?? null,
  }));

  const payload = {
    invoice_subtotal: opts.invoice_subtotal,
    supplier_hint: opts.supplier_hint,
    product_count: slim.length,
    products: slim,
  };

  const userPrompt =
    `Grade this extraction. Return JSON only — no prose, no markdown fences.\n\n` +
    `Extraction payload:\n\`\`\`json\n${JSON.stringify(payload).slice(0, 60000)}\n\`\`\``;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SONIC_GRADER_MODEL,
      max_tokens: 1500,
      system: SONIC_OUTCOMES_RUBRIC,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      passed: false, score: 0, criteria: {}, failures: [`grader API ${response.status}`],
      reextract_needed: false, reextract_reason: "", error: errText.slice(0, 300),
    };
  }

  const data = await response.json();
  const text = (data?.content || [])
    .filter((b: Record<string, unknown>) => b.type === "text")
    .map((b: Record<string, unknown>) => String(b.text || ""))
    .join("\n")
    .trim();

  // Strip ``` fences if Claude added them despite instruction
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Find first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      passed: false, score: 0, criteria: {}, failures: ["grader returned no JSON"],
      reextract_needed: false, reextract_reason: "", error: text.slice(0, 300),
    };
  }
  try {
    const parsed = JSON.parse(match[0]);
    const criteria = (parsed.criteria ?? {}) as Record<string, string>;
    // Recompute score deterministically: pass + unverified count toward score.
    const entries = Object.entries(criteria);
    const total = entries.length || 7;
    const passing = entries.filter(([, v]) => v === "pass" || v === "unverified").length;
    const score = Math.round((passing / total) * 100);
    const failed = entries.filter(([, v]) => v === "fail").length;
    return {
      passed: failed === 0,
      score,
      criteria,
      failures: Array.isArray(parsed.failures) ? parsed.failures : [],
      reextract_needed: !!parsed.reextract_needed,
      reextract_reason: String(parsed.reextract_reason ?? ""),
    };
  } catch (e) {
    return {
      passed: false, score: 0, criteria: {}, failures: ["grader JSON parse failed"],
      reextract_needed: false, reextract_reason: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
