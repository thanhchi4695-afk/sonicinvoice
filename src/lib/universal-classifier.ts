// ──────────────────────────────────────────────────────────────
// Universal Classifier client — always-on layer.
//
// Wraps the `classify-invoice-pattern` edge function and merges
// results with cached user + shared supplier profiles so we can
// short-circuit when a known supplier (or shared template) exists.
// ──────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";

export type InvoicePattern = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface UniversalClassification {
  detected_pattern: InvoicePattern;
  supplier_name: string;
  supplier_abn: string | null;
  column_map: Record<string, string>;
  gst_treatment: "inc" | "ex" | "nz_inc" | "unknown";
  has_rrp: boolean;
  sku_format: string;
  size_in_sku: boolean;
  colour_in_name: boolean;
  confidence: number;       // 0–100
  reasoning?: string;
  /** "user" if we already had this supplier in supplier_intelligence,
   *  "shared" if we hit the cross-client pool,
   *  "ai" if we ran the classifier from scratch. */
  source: "user" | "shared" | "ai";
}

function normalize(name: string): string {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 &-]/g, "");
}

export const PATTERN_LABEL: Record<InvoicePattern, string> = {
  A: "Flat rows · explicit columns",
  B: "Parent–child · size columns",
  C: "SKU per size",
  D: "Size & colour in name",
  E: "Code-only rows",
  F: "Multi-invoice PDF",
  G: "Ecommerce receipt",
  H: "Handwritten / low structure",
};

export async function classifyInvoice(input: {
  fileContent: string;
  fileType: string;
  fileName: string;
  hintedSupplier?: string;
}): Promise<UniversalClassification> {
  // 1) User-cached supplier? Skip the AI call.
  if (input.hintedSupplier) {
    const cached = await loadUserProfile(input.hintedSupplier);
    if (cached) return { ...cached, source: "user" };
  }

  // 2) Run the cheap AI classifier
  const { data, error } = await supabase.functions.invoke("classify-invoice-pattern", {
    body: { fileContent: input.fileContent, fileType: input.fileType, fileName: input.fileName },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);

  const ai = (data.classification || {}) as UniversalClassification;

  // 3) Merge with shared community template if one exists
  const shared = await loadSharedProfile(ai.supplier_name);
  if (shared) {
    return {
      ...ai,
      ...shared,
      // AI confidence wins if higher than shared
      confidence: Math.max(ai.confidence || 0, shared.confidence || 0),
      source: "shared",
    };
  }

  return { ...ai, source: "ai" };
}

async function loadUserProfile(supplierName: string): Promise<UniversalClassification | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data } = await supabase
      .from("supplier_intelligence")
      .select("supplier_name, column_map, detected_pattern, gst_on_cost")
      .eq("user_id", session.user.id)
      .ilike("supplier_name", supplierName)
      .maybeSingle();
    if (!data || !data.detected_pattern) return null;
    return {
      detected_pattern: (data.detected_pattern as InvoicePattern) || "A",
      supplier_name: data.supplier_name,
      supplier_abn: null,
      column_map: (data.column_map as Record<string, string>) || {},
      gst_treatment: data.gst_on_cost === false ? "ex" : "inc",
      has_rrp: false,
      sku_format: "unknown",
      size_in_sku: false,
      colour_in_name: false,
      confidence: 92,
      source: "user",
    };
  } catch {
    return null;
  }
}

async function loadSharedProfile(supplierName: string): Promise<Partial<UniversalClassification> & { confidence: number } | null> {
  try {
    const normalized = normalize(supplierName);
    if (!normalized) return null;
    const { data } = await supabase
      .from("shared_supplier_profiles")
      .select("*")
      .eq("supplier_name_normalized", normalized)
      .maybeSingle();
    if (!data) return null;
    return {
      detected_pattern: (data.detected_pattern as InvoicePattern) || "A",
      column_map: (data.column_map as Record<string, string>) || {},
      gst_treatment: (data.gst_treatment as UniversalClassification["gst_treatment"]) || "unknown",
      has_rrp: !!data.has_rrp,
      sku_format: data.sku_format || "unknown",
      size_in_sku: !!data.size_in_sku,
      colour_in_name: !!data.colour_in_name,
      confidence: Number(data.confidence_score) || 60,
    };
  } catch {
    return null;
  }
}

// ── Settings ────────────────────────────────────────────────
export async function getContributeShared(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return true;
    const { data } = await supabase
      .from("user_brain_settings")
      .select("contribute_shared")
      .eq("user_id", session.user.id)
      .maybeSingle();
    return data?.contribute_shared !== false; // default ON
  } catch {
    return true;
  }
}

export async function setContributeShared(on: boolean): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from("user_brain_settings").upsert({
    user_id: session.user.id,
    contribute_shared: on,
    updated_at: new Date().toISOString(),
  } as never);
}

// ── Privileged write to shared pool (only structural data) ──
export async function contributeSharedProfile(input: {
  supplier_name: string;
  supplier_abn?: string | null;
  detected_pattern: InvoicePattern;
  column_map: Record<string, string>;
  gst_treatment: string;
  has_rrp: boolean;
  sku_format: string;
  size_in_sku: boolean;
  colour_in_name: boolean;
  correction_rate: number;
}): Promise<void> {
  try {
    await supabase.functions.invoke("share-supplier-profile", { body: input });
  } catch (err) {
    console.warn("contributeSharedProfile failed:", err);
  }
}
