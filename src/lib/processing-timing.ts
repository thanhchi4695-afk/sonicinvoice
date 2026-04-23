// ══════════════════════════════════════════════════════════
// Processing-time + line-edit audit helpers
// Powers:
//   • Real "Time" column in Processing History (Bug #5, #12)
//   • Honest ETA on the Reading screen (Bug #4, #11)
//   • Real "Edits" column in Processing History (Bug #13)
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

/**
 * Format seconds for the completion banner / history table.
 * < 60s   → "12s"
 * < 3600s → "1m 30s"
 * else    → "1h 5m"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Honest ETA helper.
 *  - Returns null if we can't make a confident estimate yet → caller should render "Estimating…"
 *  - Never returns less than (elapsed - 1) seconds → never lies that "~3s" remain
 *    when the user has already been waiting 60s.
 *  - Caps at 5 minutes; longer → caller should render "Still working…".
 */
export function estimateEta(opts: {
  elapsedSeconds: number;
  completedStages: number;
  totalStages: number;
}): { etaSeconds: number; capped: boolean } | null {
  const { elapsedSeconds, completedStages, totalStages } = opts;
  if (totalStages <= 0 || completedStages <= 0) return null;
  if (completedStages >= totalStages) return { etaSeconds: 0, capped: false };

  const avgPerStage = elapsedSeconds / completedStages;
  const remainingStages = totalStages - completedStages;
  const naive = Math.round(avgPerStage * remainingStages);

  // Floor at 1s so we never claim instant completion mid-pipeline.
  const eta = Math.max(1, naive);

  if (eta > 300) return { etaSeconds: 300, capped: true };
  return { etaSeconds: eta, capped: false };
}

// ── Per-field edit audit (Bug #13) ──────────────────────────
export interface LineEditRecord {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  rowIndex?: number;
}

/**
 * Fire-and-forget. Records per-field edits made on the Review screen so
 * the Processing History "Edits" column reflects actual user intervention
 * and so Brain learning can prioritise the fields users edit most.
 *
 * `invoicePatternId` may be null if no pattern row exists yet — in that
 * case we attach edits to the user's most recent pattern.
 */
export function recordLineEdits(
  edits: LineEditRecord[],
  invoicePatternId: string | null,
): void {
  if (edits.length === 0) return;

  void (async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id;
      if (!userId) return;

      let patternId = invoicePatternId;
      if (!patternId) {
        const { data: latest } = await supabase
          .from("invoice_patterns" as any)
          .select("id")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1);
        patternId = ((latest || []) as unknown as Array<{ id: string }>)[0]?.id ?? null;
      }
      if (!patternId) return;

      const rows = edits.map((e) => ({
        user_id: userId,
        invoice_pattern_id: patternId,
        field: e.field,
        old_value: e.oldValue,
        new_value: e.newValue,
        row_index: e.rowIndex ?? null,
      }));

      await supabase.from("invoice_line_edits" as any).insert(rows as never);
    } catch (err) {
      console.warn("[Sonic Invoice] recordLineEdits failed:", err);
    }
  })();
}

/**
 * Persist actual server-side processing duration on the matching pattern row.
 * Fire-and-forget. Uses fingerprint when available, else most recent row.
 */
export function recordProcessingDuration(opts: {
  startedAt: number;
  completedAt: number;
  rowsSeen?: number;
  variantsExtracted?: number;
  layoutFingerprint?: string | null;
}): void {
  const durationSec = Math.max(0, Math.round((opts.completedAt - opts.startedAt) / 1000));

  void (async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id;
      if (!userId) return;

      let patternId: string | undefined;
      if (opts.layoutFingerprint) {
        const { data } = await supabase
          .from("invoice_patterns" as any)
          .select("id")
          .eq("user_id", userId)
          .eq("layout_fingerprint", opts.layoutFingerprint)
          .order("updated_at", { ascending: false })
          .limit(1);
        patternId = ((data || []) as unknown as Array<{ id: string }>)[0]?.id;
      }
      if (!patternId) {
        const { data } = await supabase
          .from("invoice_patterns" as any)
          .select("id")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1);
        patternId = ((data || []) as unknown as Array<{ id: string }>)[0]?.id;
      }
      if (!patternId) return;

      const update: Record<string, unknown> = {
        processing_started_at: new Date(opts.startedAt).toISOString(),
        processing_completed_at: new Date(opts.completedAt).toISOString(),
        processing_duration_seconds: durationSec,
      };
      if (opts.rowsSeen != null) update.rows_seen = opts.rowsSeen;
      if (opts.variantsExtracted != null) update.variants_extracted = opts.variantsExtracted;

      await supabase
        .from("invoice_patterns" as any)
        .update(update as never)
        .eq("id", patternId);
    } catch (err) {
      console.warn("[Sonic Invoice] recordProcessingDuration failed:", err);
    }
  })();
}
