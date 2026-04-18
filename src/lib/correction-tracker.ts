import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Logs a single user correction to the correction_log table and resolves the
 * supplier_profile_id automatically by name. Fire-and-forget — never throws.
 *
 * After 3+ corrections to the same field for the same supplier, prompts the
 * user to update the saved invoice_pattern rule for that field.
 */

export type CorrectionReason =
  | "wrong_column_detected"
  | "wrong_format"
  | "currency_error"
  | "size_system_wrong"
  | "missed_field"
  | "wrong_value"
  | "other"
  | "unspecified";

export type FieldCategory = "identification" | "pricing" | "variant" | "metadata";

/** Derive the canonical category for any edited field name. */
export function deriveFieldCategory(field: string): FieldCategory {
  const f = field.toLowerCase();
  if (["name", "title", "sku", "style", "style_number", "style_code"].some(k => f.includes(k))) return "identification";
  if (["cost", "rrp", "price", "markup"].some(k => f.includes(k))) return "pricing";
  if (["size", "colour", "color", "qty", "quantity"].some(k => f.includes(k))) return "variant";
  return "metadata"; // supplier, brand, vendor, date, …
}

interface LogCorrectionInput {
  supplierName: string;
  field: string;          // canonical field name e.g. "cost", "name", "colour"
  originalValue: string;
  correctedValue: string;
  /** Sample headers + a sample row from the current invoice — needed if the
   *  user agrees to "Update rule" so we can re-train invoice_patterns. */
  rawHeaders?: string[];
  sampleRows?: Record<string, unknown>[];
  formatType?: string | null;
  extractedProducts?: Record<string, unknown>[];
  correctionReason?: CorrectionReason | null;
  correctionReasonDetail?: string | null;
  fieldCategory?: FieldCategory;
  autoDetected?: boolean;
  sessionInvoiceIndex?: number | null;
  /** Optional plain-text invoice identifier (filename, doc number, or session id). */
  invoiceId?: string | null;
}

// In-memory tally for this session: key = `${supplierName}::${field}`
const correctionTally = new Map<string, number>();
// Track which (supplier, field) pairs we've already prompted so we don't nag.
const promptedKeys = new Set<string>();
// Pairs the user explicitly chose to ignore for this session.
const ignoredKeys = new Set<string>();

/** Optional callback the Review screen can register so the "Apply to all"
 *  follow-up prompt can bulk-update remaining rows in the current session. */
export type ApplyToRemainingRowsFn = (args: {
  field: string;
  originalValue: string;
  correctedValue: string;
}) => number; // returns count of rows that would be updated
let applyToRemainingRowsFn: ApplyToRemainingRowsFn | null = null;
export function registerApplyToRemainingRowsHandler(fn: ApplyToRemainingRowsFn | null) {
  applyToRemainingRowsFn = fn;
}

export async function logCorrection(input: LogCorrectionInput): Promise<void> {
  const { supplierName, field, originalValue, correctedValue } = input;
  if (!supplierName || !field) return;
  if (originalValue === correctedValue) return;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return;

    // Resolve supplier_profile_id by name (or variant match).
    const normalised = supplierName.trim().toLowerCase();
    const { data: profiles } = await supabase
      .from("supplier_profiles")
      .select("id, supplier_name, supplier_name_variants")
      .eq("user_id", userId)
      .eq("is_active", true);

    const profile = (profiles || []).find((p: any) => {
      if (p.supplier_name?.trim().toLowerCase() === normalised) return true;
      const variants: string[] = p.supplier_name_variants || [];
      return variants.some((v) => v?.trim().toLowerCase() === normalised);
    });

    // Look up the most recent invoice_pattern for this supplier (optional).
    let invoicePatternId: string | null = null;
    if (profile?.id) {
      const { data: pattern } = await supabase
        .from("invoice_patterns")
        .select("id")
        .eq("supplier_profile_id", profile.id)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      invoicePatternId = pattern?.id ?? null;
    }

    await supabase.from("correction_log").insert({
      user_id: userId,
      supplier_profile_id: profile?.id ?? null,
      invoice_pattern_id: invoicePatternId,
      supplier_name: supplierName,
      invoice_id: input.invoiceId ?? null,
      field_corrected: field,
      original_value: originalValue.slice(0, 500),
      corrected_value: correctedValue.slice(0, 500),
      correction_reason: input.correctionReason ?? null,
      correction_reason_detail: input.correctionReasonDetail?.slice(0, 500) ?? null,
      field_category: input.fieldCategory ?? deriveFieldCategory(field),
      auto_detected: input.autoDetected ?? false,
      session_invoice_index: input.sessionInvoiceIndex ?? null,
    } as never);

    // Tally on supplier name so we still prompt even without a supplier_profiles row.
    const tallyKey = `${normalised}::${field}`;
    if (ignoredKeys.has(tallyKey)) return;
    const next = (correctionTally.get(tallyKey) || 0) + 1;
    correctionTally.set(tallyKey, next);

    if (next >= 3 && !promptedKeys.has(tallyKey)) {
      promptedKeys.add(tallyKey);
      promptUpdateRule({
        supplierProfileId: profile?.id ?? null,
        supplierName,
        field,
        originalValue,
        latestCorrected: correctedValue,
        rawHeaders: input.rawHeaders || [],
        sampleRows: input.sampleRows || [],
        formatType: input.formatType ?? null,
        extractedProducts: input.extractedProducts || [],
        tallyKey,
      });
    }
  } catch (err) {
    console.warn("logCorrection failed silently:", err);
  }
}

interface PromptArgs {
  supplierProfileId: string | null;
  supplierName: string;
  field: string;
  originalValue: string;
  latestCorrected: string;
  rawHeaders: string[];
  sampleRows: Record<string, unknown>[];
  formatType: string | null;
  extractedProducts: Record<string, unknown>[];
  tallyKey: string;
}

function promptUpdateRule(args: PromptArgs) {
  const { supplierName, field, tallyKey } = args;
  toast(`You've corrected ${field} for ${supplierName} 3 times`, {
    description: "Update the saved rule for future invoices?",
    duration: 12000,
    action: {
      label: "Update rule",
      onClick: () => triggerRuleUpdate(args),
    },
    cancel: {
      label: "Ignore",
      onClick: () => {
        ignoredKeys.add(tallyKey);
      },
    },
  });
}

/** Bump confidence_score by +5 (clamped 0–100) and merge the field into column_map. */
async function updateSupplierIntelligence(
  userId: string,
  supplierName: string,
  field: string,
  correctedValue: string,
) {
  const { data: row } = await supabase
    .from("supplier_intelligence")
    .select("id, confidence_score, column_map")
    .eq("user_id", userId)
    .eq("supplier_name", supplierName)
    .maybeSingle();

  const existingMap =
    (row?.column_map as Record<string, string> | null) ?? {};
  const mergedMap = { ...existingMap, [field]: correctedValue };
  const nextConfidence = Math.min(
    100,
    Math.max(0, (row?.confidence_score ?? 20) + 5),
  );

  if (row?.id) {
    await supabase
      .from("supplier_intelligence")
      .update({
        confidence_score: nextConfidence,
        column_map: mergedMap as never,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
  } else {
    await supabase.from("supplier_intelligence").insert({
      user_id: userId,
      supplier_name: supplierName,
      column_map: mergedMap as never,
      confidence_score: 25,
      invoice_count: 1,
      last_match_method: "manual_edit",
      last_invoice_date: new Date().toISOString(),
    } as never);
  }
  return nextConfidence;
}

async function triggerRuleUpdate(args: PromptArgs) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    // Fire pattern-extraction in parallel; don't block the toast on it.
    void supabase.functions.invoke("extract-supplier-pattern", {
      body: {
        supplier_name: args.supplierName,
        raw_headers: args.rawHeaders,
        sample_rows: args.sampleRows,
        format_type: args.formatType,
        extracted_products: args.extractedProducts,
        corrections_override: {
          field: args.field,
          corrected_value: args.latestCorrected,
          supplier_profile_id: args.supplierProfileId,
        },
      },
    });

    if (userId) {
      await updateSupplierIntelligence(
        userId,
        args.supplierName,
        args.field,
        args.latestCorrected,
      );
      // Audit trail entry.
      await supabase.from("supplier_learning_log").insert({
        user_id: userId,
        supplier_name: args.supplierName,
        event_type: "manual_edit",
        match_method: "rule_prompt",
        confidence_before: null,
        confidence_after: null,
        details: { field: args.field, corrected_value: args.latestCorrected } as never,
      } as never);
    }

    toast.success(
      `Rule updated — ${args.field} mapping saved for ${args.supplierName}`,
      { duration: 3500 },
    );

    // Reset the tally so we don't immediately re-prompt for the same field.
    correctionTally.set(args.tallyKey, 0);
    promptedKeys.delete(args.tallyKey);

    // Follow-up: offer to bulk-apply this same correction to remaining rows.
    if (applyToRemainingRowsFn) {
      // Dry-run count — handler should return the count without mutating state
      // when called via the toast button below; we estimate up-front using the
      // sampleRows the caller passed in. For simplicity we always show the
      // prompt and let the handler skip if zero.
      setTimeout(() => {
        toast(`Apply this correction to other rows with the same value?`, {
          description: `"${args.originalValue}" → "${args.latestCorrected}" in ${args.field}`,
          duration: 10000,
          action: {
            label: "Apply to all",
            onClick: () => {
              const updated = applyToRemainingRowsFn?.({
                field: args.field,
                originalValue: args.originalValue,
                correctedValue: args.latestCorrected,
              }) ?? 0;
              if (updated > 0) {
                toast.success(`Applied to ${updated} row${updated === 1 ? "" : "s"}`, {
                  duration: 2500,
                });
              } else {
                toast.info("No other rows matched", { duration: 2000 });
              }
            },
          },
          cancel: { label: "No, just save the rule", onClick: () => {} },
        });
      }, 600);
    }
  } catch (err) {
    console.warn("Rule update failed:", err);
    toast.error("Couldn't update rule", {
      description: "We'll keep tracking your corrections — try again later.",
    });
  }
}

/** Reset session tallies (e.g. on logout or a new invoice load). */
export function resetCorrectionTally() {
  correctionTally.clear();
  promptedKeys.clear();
  ignoredKeys.clear();
}
