// ══════════════════════════════════════════════════════════
// Processing Quality Tracker — measures how much manual
// intervention an extracted invoice required, and records the
// result against the user's invoice_patterns row.
// Fire-and-forget — never blocks the UI / export.
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

export interface QualityMetricsInput {
  reviewStartedAt: number | null;
  exportedAt: number;
  editCount: number;
  fieldsCorrected: string[];
  rowsDeleted: number;
  rowsAdded: number;
  layoutFingerprint: string | null;
}

export interface ComputedQualityMetrics {
  review_duration_seconds: number;
  edit_count: number;
  fields_corrected: string[];
  rows_deleted: number;
  rows_added: number;
  processing_quality_score: number;
  exported_at: string;
}

/** Derive the 0–100 processing quality score per the agreed rules. */
export function computeQualityScore(input: {
  editCount: number;
  rowsDeleted: number;
  reviewDurationSeconds: number;
}): number {
  let score = 100;

  // Edit penalty — capped at -30
  score -= Math.min(30, input.editCount * 3);

  // Deleted rows — capped at -20
  score -= Math.min(20, input.rowsDeleted * 5);

  // Time penalties (mutually exclusive — bigger one applies)
  if (input.reviewDurationSeconds > 15 * 60) score -= 20;
  else if (input.reviewDurationSeconds > 5 * 60) score -= 10;

  // Bonus: super-quick clean export
  if (input.reviewDurationSeconds < 60 && input.editCount === 0) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function buildQualityMetrics(input: QualityMetricsInput): ComputedQualityMetrics {
  const startedAt = input.reviewStartedAt ?? input.exportedAt;
  const review_duration_seconds = Math.max(
    0,
    Math.round((input.exportedAt - startedAt) / 1000),
  );

  return {
    review_duration_seconds,
    edit_count: input.editCount,
    fields_corrected: Array.from(new Set(input.fieldsCorrected)),
    rows_deleted: input.rowsDeleted,
    rows_added: input.rowsAdded,
    processing_quality_score: computeQualityScore({
      editCount: input.editCount,
      rowsDeleted: input.rowsDeleted,
      reviewDurationSeconds: review_duration_seconds,
    }),
    exported_at: new Date(input.exportedAt).toISOString(),
  };
}

/**
 * Fire-and-forget. Records the metrics on the user's most recent
 * invoice_patterns row matching the given fingerprint. Silent on failure.
 */
export function recordProcessingQuality(input: QualityMetricsInput): void {
  if (!input.layoutFingerprint) return;
  const metrics = buildQualityMetrics(input);

  void (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;

      // Find the latest invoice_patterns row for this fingerprint.
      const { data: rows } = await supabase
        .from("invoice_patterns" as any)
        .select("id")
        .eq("user_id", userId)
        .eq("layout_fingerprint", input.layoutFingerprint)
        .order("updated_at", { ascending: false })
        .limit(1);

      const patternId = ((rows || []) as unknown as Array<{ id: string }>)[0]?.id;
      if (!patternId) return; // training row may not exist yet — silent skip

      await supabase
        .from("invoice_patterns" as any)
        .update(metrics as never)
        .eq("id", patternId);
    } catch (err) {
      console.warn("[Sonic Invoice] recordProcessingQuality failed:", err);
    }
  })();
}
