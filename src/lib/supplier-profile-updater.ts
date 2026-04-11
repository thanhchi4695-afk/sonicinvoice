import { supabase } from "@/integrations/supabase/client";
import type { ValidatedProduct } from "@/lib/invoice-validator";

interface ProfileCorrection {
  type: "field_edit" | "rejection" | "restoration" | "reclassification" | "noise_pattern" | "colour_mapping";
  field: string;
  original: string;
  corrected: string;
  reason?: string;
}

/**
 * Collect all user corrections from reviewed products by comparing
 * original AI extraction (_raw* fields) with final accepted values.
 */
export function collectCorrections(
  products: ValidatedProduct[],
): ProfileCorrection[] {
  const corrections: ProfileCorrection[] = [];

  for (const p of products) {
    // Manual field edits (name changed from raw)
    if ((p as any)._manuallyEdited) {
      if (p._rawName && p.name && p.name !== p._rawName) {
        corrections.push({
          type: "field_edit",
          field: "product_name",
          original: p._rawName,
          corrected: p.name,
          reason: "User corrected product name",
        });
      }
      if (p._rawCost !== undefined && p.cost !== p._rawCost) {
        corrections.push({
          type: "field_edit",
          field: "unit_cost",
          original: String(p._rawCost),
          corrected: String(p.cost),
          reason: "User corrected cost",
        });
      }
    }

    // Rejected rows = noise patterns
    if (p._rejected && p._rawName) {
      corrections.push({
        type: "noise_pattern",
        field: "rejection",
        original: p._rawName,
        corrected: "",
        reason: p._rejectReason || "User rejected as non-product",
      });
    }

    // AI auto-corrections that were accepted (confirm patterns)
    for (const c of p._corrections || []) {
      corrections.push({
        type: "field_edit",
        field: c.field,
        original: c.from || "",
        corrected: c.to,
        reason: c.reason,
      });
    }
  }

  return corrections;
}

/**
 * After user confirms/exports, update the supplier profile with corrections.
 * Runs in background — doesn't block the export flow.
 */
export async function updateSupplierProfileWithCorrections(
  supplierName: string,
  products: ValidatedProduct[],
): Promise<void> {
  if (!supplierName) return;

  const corrections = collectCorrections(products);
  if (corrections.length === 0) return;

  try {
    // Load existing profile
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return;

    const { data: existing } = await supabase
      .from("supplier_profiles")
      .select("id, profile_data, invoices_analysed")
      .eq("supplier_name", supplierName)
      .eq("is_active", true)
      .maybeSingle();

    // Call edge function to merge corrections
    const { data, error } = await supabase.functions.invoke("update-supplier-profile", {
      body: {
        existingProfile: existing?.profile_data || null,
        corrections,
        supplierName,
      },
    });

    if (error) {
      console.error("Profile update error:", error);
      return;
    }

    const updatedProfile = data?.profile;
    if (!updatedProfile) return;

    // Upsert profile
    if (existing?.id) {
      await supabase
        .from("supplier_profiles")
        .update({
          profile_data: updatedProfile,
          invoices_analysed: (existing.invoices_analysed || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("supplier_profiles")
        .insert({
          user_id: session.session.user.id,
          supplier_name: supplierName,
          profile_data: updatedProfile,
          invoices_analysed: 1,
          is_active: true,
        });
    }

    console.log(`✅ Supplier profile updated for "${supplierName}" with ${corrections.length} corrections`);
  } catch (err) {
    console.error("Failed to update supplier profile:", err);
  }
}
