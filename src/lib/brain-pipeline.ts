// ──────────────────────────────────────────────────────────────
// Brain Mode Pipeline
// Coordinates the new 5-stage extraction:
//   1) orient-invoice            (AI)
//   2) fingerprint-layout        (AI)   — skipped on cache hit
//   3+4) extract-with-context    (AI)
//   5) validateBrainProducts     (local)
//
// Caching: when a supplier profile already exists in
// `supplier_intelligence` + `invoice_patterns`, Stages 1 and 2
// are skipped and the cached orientation + layout are reused.
// ──────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
import {
  validateBrainProducts,
  type BrainProduct,
  type BrainValidationSummary,
} from "@/lib/brain-validator";
import {
  classifyInvoice,
  contributeSharedProfile,
  type UniversalClassification,
} from "@/lib/universal-classifier";

// ── localStorage feature flag (default OFF) ─────────────────
const FLAG_KEY = "sonic_brain_mode_enabled";

export function isBrainModeEnabled(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
}
export function setBrainModeEnabled(on: boolean): void {
  try { localStorage.setItem(FLAG_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

// ── Cached profile shape ────────────────────────────────────
export interface CachedSupplierBrain {
  supplier_name: string;
  orientation: Record<string, unknown> | null;
  layout: Record<string, unknown> | null;
  layout_fingerprint?: string | null;
  invoice_count: number;
}

// ── Main entry ──────────────────────────────────────────────
export interface BrainPipelineInput {
  fileContent: string;        // base64
  fileType: string;           // pdf | jpg | png | webp
  fileName: string;
  customInstructions?: string;
  /** If the user has already named the supplier, pass it for cache lookup. */
  hintedSupplier?: string;
}

export interface BrainPipelineResult {
  products: BrainProduct[];
  summary: BrainValidationSummary;
  orientation: Record<string, unknown>;
  layout: Record<string, unknown>;
  context_map: Record<string, unknown>;
  /** True when the cached profile was reused and Stages 1+2 were skipped. */
  recognised: boolean;
  /** Supplier name that the brain ended up keyed against. */
  supplierName: string;
  /** Universal pattern classification (always run). */
  classification: UniversalClassification;
  /** True when classifier confidence < 60 → trigger guided wizard. */
  needsTeach: boolean;
  /** Stage timings (ms) for diagnostics. */
  timings: Record<string, number>;
}

async function invokeStage<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(`${name}: ${error.message}`);
  if (data?.error) throw new Error(`${name}: ${data.error}`);
  return data as T;
}

async function loadCachedBrain(supplierName: string | undefined): Promise<CachedSupplierBrain | null> {
  if (!supplierName) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: intel } = await supabase
      .from("supplier_intelligence")
      .select("supplier_name, column_map, size_system, invoice_count, last_match_method")
      .eq("user_id", session.user.id)
      .ilike("supplier_name", supplierName)
      .maybeSingle();

    if (!intel) return null;

    const { data: pattern } = await supabase
      .from("invoice_patterns")
      .select("layout_fingerprint, format_type, column_map, sample_headers")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // We rebuild orientation + layout from the cached intelligence so the
    // extraction stage receives the exact same shape as the live AI calls.
    const orientation = {
      supplier_name: intel.supplier_name,
      document_type: "invoice",
      currency: "AUD",
      gst_included: true,
      table_start_page: 1,
      column_headers: Array.isArray(pattern?.sample_headers)
        ? (pattern!.sample_headers as string[]).map(label => ({ label, maps_to: "unknown" }))
        : Object.entries((intel.column_map as Record<string, string>) || {}).map(
            ([label, maps_to]) => ({ label, maps_to }),
          ),
      confidence: 90,
      cached: true,
    };
    const layout = {
      layout_type: pattern?.format_type || "flat_rows",
      spans_multiple_pages: false,
      has_section_headers: false,
      size_columns: [],
      confidence: 90,
      cached: true,
    };
    return {
      supplier_name: intel.supplier_name,
      orientation,
      layout,
      layout_fingerprint: pattern?.layout_fingerprint || null,
      invoice_count: intel.invoice_count || 0,
    };
  } catch (err) {
    console.warn("loadCachedBrain failed:", err);
    return null;
  }
}

export async function runBrainPipeline(input: BrainPipelineInput): Promise<BrainPipelineResult> {
  const timings: Record<string, number> = {};
  const t0 = performance.now();

  // ── Stage 0 — Universal Pattern Classifier (always-on) ──
  const tCls = performance.now();
  const classification = await classifyInvoice({
    fileContent: input.fileContent,
    fileType: input.fileType,
    fileName: input.fileName,
    hintedSupplier: input.hintedSupplier,
  });
  timings.stage0_classify = performance.now() - tCls;

  // ── Try cache hit (skip Stages 1 + 2) ──
  const supplierForCache = input.hintedSupplier || classification.supplier_name;
  const cached = await loadCachedBrain(supplierForCache);
  let orientation: Record<string, unknown>;
  let layout: Record<string, unknown>;
  let recognised = false;

  if (cached?.orientation && cached?.layout) {
    orientation = cached.orientation;
    layout = cached.layout;
    recognised = true;
    timings.cache_lookup = performance.now() - t0;
  } else {
    // Stage 1 — Orientation
    const tOri = performance.now();
    const oriRes = await invokeStage<{ orientation: Record<string, unknown> }>(
      "orient-invoice",
      { fileContent: input.fileContent, fileType: input.fileType, fileName: input.fileName },
    );
    orientation = oriRes.orientation;
    timings.stage1_orientation = performance.now() - tOri;

    // Stage 2 — Layout fingerprint
    const tLay = performance.now();
    const layRes = await invokeStage<{ layout: Record<string, unknown> }>(
      "fingerprint-layout",
      { fileContent: input.fileContent, fileType: input.fileType, fileName: input.fileName, orientation },
    );
    layout = layRes.layout;
    timings.stage2_layout = performance.now() - tLay;
  }

  // Stages 3 + 4 — Context map + Extraction (passes classification as a hint)
  const tExt = performance.now();
  const extRes = await invokeStage<{
    products: BrainProduct[];
    context_map: Record<string, unknown>;
  }>("extract-with-context", {
    fileContent: input.fileContent,
    fileType: input.fileType,
    fileName: input.fileName,
    orientation,
    layout,
    customInstructions: input.customInstructions,
    classification,
  });
  timings.stage34_extract = performance.now() - tExt;

  // Stage 5 — Local validation
  const tVal = performance.now();
  const summary = validateBrainProducts(extRes.products);
  timings.stage5_validate = performance.now() - tVal;

  return {
    products: extRes.products,
    summary,
    orientation,
    layout,
    context_map: extRes.context_map || {},
    recognised,
    supplierName: (cached?.supplier_name || classification.supplier_name || (orientation.supplier_name as string) || input.hintedSupplier || "").trim(),
    classification,
    needsTeach: classification.confidence < 60,
    timings,
  };
}

// ──────────────────────────────────────────────────────────────
// Persist learnings back to the supplier brain
// Called from the Review screen after the user accepts/corrects.
// ──────────────────────────────────────────────────────────────

export interface BrainLearnInput {
  supplierName: string;
  orientation: Record<string, unknown>;
  layout: Record<string, unknown>;
  acceptedProducts: BrainProduct[];
  correctionCount: number;
  /** Universal classification result from Stage 0 (used for pattern + shared pool). */
  classification?: UniversalClassification;
}

export async function saveBrainLearnings(input: BrainLearnInput): Promise<void> {
  if (!input.supplierName) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const userId = session.user.id;

    // Build column_map from orientation.column_headers
    const headers = (input.orientation.column_headers as Array<{ label: string; maps_to: string }>) || [];
    const columnMap: Record<string, string> = {};
    for (const h of headers) {
      if (h?.label && h?.maps_to && h.maps_to !== "unknown") columnMap[h.label] = h.maps_to;
    }

    // Compute typical_margin_range from accepted products
    const margins = input.acceptedProducts
      .map(p => {
        const cost = Number(p.cost_ex_gst) || 0;
        const rrp = Number(p.rrp_inc_gst) || 0;
        return cost > 0 && rrp > 0 ? (rrp - cost * 1.1) / rrp : NaN;
      })
      .filter(m => Number.isFinite(m));
    const marginMin = margins.length ? Math.min(...margins) : null;
    const marginMax = margins.length ? Math.max(...margins) : null;

    // Upsert supplier_intelligence
    const { data: existing } = await supabase
      .from("supplier_intelligence")
      .select("id, invoice_count, name_variants, column_map")
      .eq("user_id", userId)
      .ilike("supplier_name", input.supplierName)
      .maybeSingle();

    const mergedColumnMap = {
      ...((existing?.column_map as Record<string, string>) || {}),
      ...columnMap,
    };

    const detectedPattern = input.classification?.detected_pattern || null;
    const correctionRate = input.acceptedProducts.length
      ? input.correctionCount / Math.max(1, input.acceptedProducts.length)
      : 0;

    if (existing?.id) {
      await supabase.from("supplier_intelligence").update({
        column_map: mergedColumnMap as never,
        invoice_count: (existing.invoice_count || 0) + 1,
        size_system: (input.layout.size_columns as string[])?.length ? "matrix" : null,
        last_match_method: "brain_mode",
        last_invoice_date: new Date().toISOString(),
        gst_on_cost: !!input.orientation.gst_included,
        detected_pattern: detectedPattern,
        last_correction_rate: correctionRate,
        confidence_score: Math.max(60, Math.round(100 - correctionRate * 100)),
      } as never).eq("id", existing.id);
    } else {
      await supabase.from("supplier_intelligence").insert({
        user_id: userId,
        supplier_name: input.supplierName,
        name_variants: [],
        column_map: mergedColumnMap as never,
        confidence_score: 60,
        invoice_count: 1,
        last_match_method: "brain_mode",
        last_invoice_date: new Date().toISOString(),
        gst_on_cost: !!input.orientation.gst_included,
        detected_pattern: detectedPattern,
        last_correction_rate: correctionRate,
        is_shared_origin: input.classification?.source === "shared",
      } as never);
    }

    // Contribute structural template to the shared pool (only if user opted in)
    if (input.classification && detectedPattern) {
      void contributeSharedProfile({
        supplier_name: input.supplierName,
        supplier_abn: input.classification.supplier_abn,
        detected_pattern: detectedPattern,
        column_map: mergedColumnMap,
        gst_treatment: input.classification.gst_treatment,
        has_rrp: input.classification.has_rrp,
        sku_format: input.classification.sku_format,
        size_in_sku: input.classification.size_in_sku,
        colour_in_name: input.classification.colour_in_name,
        correction_rate: correctionRate,
      });
    }

    // Insert invoice_pattern row capturing this layout fingerprint.
    // IMPORTANT: include layout_fingerprint + supplier_profile_id so
    // (a) recordProcessingQuality can match this row on export, and
    // (b) Processing History can resolve the supplier name.
    const headerLabels = headers.map(h => h.label);
    const { generateLayoutFingerprint } = await import("@/lib/layout-fingerprint");
    const brainFingerprint = generateLayoutFingerprint(headerLabels);
    await supabase.from("invoice_patterns").insert({
      user_id: userId,
      supplier_profile_id: existing?.id ?? null,
      layout_fingerprint: brainFingerprint,
      column_map: columnMap as never,
      sample_headers: headerLabels as never,
      format_type: (input.layout.layout_type as string) || "flat_rows",
      size_system: (input.layout.size_columns as string[])?.length ? "matrix" : null,
      gst_included_in_cost: !!input.orientation.gst_included,
      default_markup_multiplier: marginMax && marginMin
        ? Number(((1 / (1 - (marginMin + marginMax) / 2))).toFixed(2))
        : null,
      fields_corrected: input.correctionCount ? [`${input.correctionCount} edits`] : null,
      match_method: "brain_mode",
      processing_quality_score: Math.max(0, 100 - input.correctionCount * 5),
    } as never);

    // Audit log entry
    await supabase.from("supplier_learning_log").insert({
      user_id: userId,
      supplier_name: input.supplierName,
      event_type: existing ? "supplier_updated" : "supplier_learned",
      match_method: "brain_mode",
      confidence_before: null,
      confidence_after: 60,
      details: {
        column_count: Object.keys(mergedColumnMap).length,
        margin_min: marginMin,
        margin_max: marginMax,
        corrections: input.correctionCount,
        layout_type: input.layout.layout_type,
      } as never,
    } as never);
  } catch (err) {
    console.warn("saveBrainLearnings failed:", err);
  }
}
