// Corrections capture log — every product-row edit, reject, accept, or override
// in the Review screen flows here. Feeds the grader rubric immediately and
// (eventually) Claude Managed Agents Dreaming for overnight profile improvement.
import { supabase } from "@/integrations/supabase/client";

export type CorrectionType =
  | "field_edit"
  | "row_reject"
  | "row_accept"
  | "vendor_override"
  | "type_override"
  | "size_correction"
  | "colour_correction";

export interface LogCorrectionArgs {
  jobId?: string | null;
  supplierKey: string;
  shopifyVendor?: string | null;
  sku?: string | null;
  styleName?: string | null;
  fieldCorrected: string;
  valueBefore: unknown;
  valueAfter: unknown;
  correctionType: CorrectionType;
  graderScoreBefore?: number | null;
  extractorUsed?: string | null;
  invoiceDate?: string | null;
}

const toStr = (v: unknown): string =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);

/** Fire-and-forget. Never throws. */
export async function logCorrection(args: LogCorrectionArgs): Promise<void> {
  try {
    if (!args.supplierKey || !args.fieldCorrected || !args.correctionType) return;
    const before = toStr(args.valueBefore);
    const after = toStr(args.valueAfter);
    if (args.correctionType === "field_edit" && before === after) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return;

    await supabase.from("corrections" as never).insert({
      user_id: userId,
      invoice_job_id: args.jobId ?? null,
      supplier_key: args.supplierKey,
      shopify_vendor: args.shopifyVendor ?? null,
      sku: args.sku ?? null,
      style_name: args.styleName ?? null,
      field_corrected: args.fieldCorrected,
      value_before: before.slice(0, 1000),
      value_after: after.slice(0, 1000),
      correction_type: args.correctionType,
      grader_score_before: args.graderScoreBefore ?? null,
      extractor_used: args.extractorUsed ?? null,
      invoice_date: args.invoiceDate ?? null,
    } as never);
  } catch (err) {
    console.warn("[corrections] logCorrection failed silently:", err);
  }
}

/** Map a field name to its specialised correction_type, defaulting to field_edit. */
export function correctionTypeFor(field: string): CorrectionType {
  const f = field.toLowerCase();
  if (f === "vendor" || f === "shopify_vendor") return "vendor_override";
  if (f === "type" || f === "product_type") return "type_override";
  if (f === "size") return "size_correction";
  if (f === "colour" || f === "color") return "colour_correction";
  return "field_edit";
}
