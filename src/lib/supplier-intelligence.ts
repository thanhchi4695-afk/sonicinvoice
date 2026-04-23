import { supabase } from "@/integrations/supabase/client";
import { normaliseVendor } from "@/lib/normalise-vendor";

/**
 * Helpers for the dedicated `supplier_intelligence` table that powers the
 * Supplier Intelligence panel. Fire-and-forget; never throws.
 *
 * - `recordSupplierLearned` is called when a new supplier is detected for
 *   the first time (toast: "New supplier learned: …").
 * - `recordSupplierUpdated` is called whenever an existing supplier's
 *   profile is refreshed (toast: "Supplier profile updated: …").
 * - Each call also writes one row to `supplier_learning_log` so the
 *   chronological tab has a full audit trail.
 */

export type SupplierMatchMethod =
  | "full_extraction"
  | "supplier_match"
  | "fingerprint_match"
  | "manual"
  | string;

export interface LearningPayload {
  supplierName: string;
  confidence?: number | null;
  columnMap?: Record<string, string> | null;
  sizeSystem?: string | null;
  skuPrefixPattern?: string | null;
  gstOnCost?: boolean | null;
  gstOnRrp?: boolean | null;
  markupMultiplier?: number | null;
  matchMethod?: SupplierMatchMethod | null;
  nameVariants?: string[];
}

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

function clampConfidence(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function appendLog(
  userId: string,
  supplierName: string,
  eventType: "supplier_learned" | "supplier_updated" | "manual_edit",
  matchMethod: string | null,
  confidenceBefore: number | null,
  confidenceAfter: number | null,
  details: Record<string, unknown>,
) {
  await supabase.from("supplier_learning_log").insert({
    user_id: userId,
    supplier_name: supplierName,
    event_type: eventType,
    match_method: matchMethod,
    confidence_before: confidenceBefore,
    confidence_after: confidenceAfter,
    details: details as never,
  } as never);
}

/** Called when a *brand new* supplier is observed. Inserts at 20% confidence. */
export async function recordSupplierLearned(payload: LearningPayload): Promise<void> {
  try {
    const userId = await getUserId();
    if (!userId || !payload.supplierName) return;

    const supplierName = normaliseVendor(payload.supplierName);
    const confidenceAfter = clampConfidence(payload.confidence, 20);

    await supabase.from("supplier_intelligence").upsert(
      {
        user_id: userId,
        supplier_name: supplierName,
        name_variants: payload.nameVariants ?? [],
        column_map: (payload.columnMap ?? {}) as never,
        confidence_score: confidenceAfter,
        invoice_count: 1,
        size_system: payload.sizeSystem ?? null,
        sku_prefix_pattern: payload.skuPrefixPattern ?? null,
        gst_on_cost: payload.gstOnCost ?? null,
        gst_on_rrp: payload.gstOnRrp ?? null,
        markup_multiplier: payload.markupMultiplier ?? null,
        last_invoice_date: new Date().toISOString(),
        last_match_method: payload.matchMethod ?? "full_extraction",
      } as never,
      { onConflict: "user_id,supplier_name", ignoreDuplicates: false } as never,
    );

    await appendLog(
      userId,
      supplierName,
      "supplier_learned",
      payload.matchMethod ?? "full_extraction",
      null,
      confidenceAfter,
      {
        size_system: payload.sizeSystem,
        sku_prefix_pattern: payload.skuPrefixPattern,
        column_count: Object.keys(payload.columnMap ?? {}).length,
      },
    );
  } catch (err) {
    console.warn("recordSupplierLearned failed silently:", err);
  }
}

/** Called when an existing supplier's profile is refreshed. */
export async function recordSupplierUpdated(payload: LearningPayload): Promise<void> {
  try {
    const userId = await getUserId();
    if (!userId || !payload.supplierName) return;

    const supplierName = normaliseVendor(payload.supplierName);

    // Read current row so we can compute "before" confidence + bump invoice_count.
    // Match case-insensitively so old un-normalised rows are still picked up.
    const { data: current } = await supabase
      .from("supplier_intelligence")
      .select("id, invoice_count, confidence_score, name_variants, column_map")
      .eq("user_id", userId)
      .ilike("supplier_name", supplierName)
      .maybeSingle();

    const confidenceBefore = current?.confidence_score ?? null;
    const confidenceAfter = clampConfidence(payload.confidence, confidenceBefore ?? 40);
    const newInvoiceCount = (current?.invoice_count ?? 0) + 1;

    // Merge column maps so a single bad invoice doesn't wipe a learned mapping.
    const mergedColumnMap = {
      ...((current?.column_map as Record<string, string> | null) ?? {}),
      ...(payload.columnMap ?? {}),
    };

    // Merge variants — dedupe case-insensitively.
    const variantsSet = new Set<string>([
      ...((current?.name_variants as string[] | null) ?? []),
      ...(payload.nameVariants ?? []),
    ]);

    if (current?.id) {
      await supabase
        .from("supplier_intelligence")
        .update({
          supplier_name: supplierName,
          confidence_score: confidenceAfter,
          invoice_count: newInvoiceCount,
          column_map: mergedColumnMap as never,
          name_variants: Array.from(variantsSet),
          size_system: payload.sizeSystem ?? null,
          sku_prefix_pattern: payload.skuPrefixPattern ?? null,
          gst_on_cost: payload.gstOnCost ?? null,
          gst_on_rrp: payload.gstOnRrp ?? null,
          markup_multiplier: payload.markupMultiplier ?? null,
          last_invoice_date: new Date().toISOString(),
          last_match_method: payload.matchMethod ?? "supplier_match",
        } as never)
        .eq("id", current.id);
    } else {
      // Fallback: row didn't exist (toast fired without a prior learn).
      await recordSupplierLearned({ ...payload, confidence: confidenceAfter });
      return;
    }

    await appendLog(
      userId,
      supplierName,
      "supplier_updated",
      payload.matchMethod ?? "supplier_match",
      confidenceBefore,
      confidenceAfter,
      {
        invoice_count: newInvoiceCount,
        column_count: Object.keys(mergedColumnMap).length,
      },
    );
  } catch (err) {
    console.warn("recordSupplierUpdated failed silently:", err);
  }
}
