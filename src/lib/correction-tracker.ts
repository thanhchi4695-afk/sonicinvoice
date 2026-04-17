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
  | "other";

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
}

// In-memory tally for this session: key = `${supplierName}::${field}`
const correctionTally = new Map<string, number>();
// Track which (supplier, field) pairs we've already prompted so we don't nag.
const promptedKeys = new Set<string>();

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
      field_corrected: field,
      original_value: originalValue.slice(0, 500),
      corrected_value: correctedValue.slice(0, 500),
    });

    // Tally for the prompt — only meaningful when we have a known supplier.
    if (!profile?.id) return;
    const key = `${profile.id}::${field}`;
    const next = (correctionTally.get(key) || 0) + 1;
    correctionTally.set(key, next);

    if (next >= 3 && !promptedKeys.has(key)) {
      promptedKeys.add(key);
      promptUpdateRule({
        supplierProfileId: profile.id,
        supplierName,
        field,
        latestCorrected: correctedValue,
        rawHeaders: input.rawHeaders || [],
        sampleRows: input.sampleRows || [],
        formatType: input.formatType ?? null,
        extractedProducts: input.extractedProducts || [],
      });
    }
  } catch (err) {
    console.warn("logCorrection failed silently:", err);
  }
}

interface PromptArgs {
  supplierProfileId: string;
  supplierName: string;
  field: string;
  latestCorrected: string;
  rawHeaders: string[];
  sampleRows: Record<string, unknown>[];
  formatType: string | null;
  extractedProducts: Record<string, unknown>[];
}

function promptUpdateRule(args: PromptArgs) {
  const { supplierName, field } = args;
  toast(`You've corrected ${field} for ${supplierName} multiple times`, {
    description:
      "Would you like to update the saved rule so the app learns from this?",
    duration: 12000,
    action: {
      label: "Update rule",
      onClick: () => triggerRuleUpdate(args),
    },
    cancel: {
      label: "Ignore",
      onClick: () => {},
    },
  });
}

async function triggerRuleUpdate(args: PromptArgs) {
  try {
    const { data, error } = await supabase.functions.invoke(
      "extract-supplier-pattern",
      {
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
      },
    );

    if (error) throw error;

    toast.success("Rule updated", {
      description: `The app will now prefer your correction for ${args.field} on future ${args.supplierName} invoices.`,
      duration: 4000,
    });

    // Reset the tally so we don't immediately re-prompt.
    correctionTally.set(`${args.supplierProfileId}::${args.field}`, 0);
    promptedKeys.delete(`${args.supplierProfileId}::${args.field}`);
    void data;
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
}
