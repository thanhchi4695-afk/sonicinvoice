// ══════════════════════════════════════════════════════════
// Invoice DB Persistence — saves parsed invoices to the
// documents + document_lines tables, and updates the
// matched supplier's performance metrics (spend, last
// invoice date, link to supplier_id).
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";
import type { ValidatedProduct } from "./invoice-validator";

interface InvoiceMeta {
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency: string;
  subtotal: number | null;
  gst: number | null;
  total: number | null;
  documentType: string;
  layoutType?: string;
  /** Original uploaded file name — shown on supplier performance page. */
  filename?: string;
}

/**
 * Normalise a string for fuzzy supplier name matching.
 * Lowercases, strips punctuation and common business suffixes.
 */
function normaliseSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|incorporated|llc|gmbh|co|corp|corporation|company|group|holdings|enterprises|trading|wholesale|australia|aus|nz)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Fuzzy-match an extracted vendor name against an existing supplier name.
 * Returns true if either name contains or starts-with the other (case-insensitive,
 * after normalisation).
 *   "Seafolly Pty Limited"  ↔  "Seafolly"            → true
 *   "Seafolly"              ↔  "Seafolly Aust P/L"   → true
 *   "Bond Eye"              ↔  "Bondi Active"        → false
 */
export function isFuzzySupplierMatch(extracted: string, stored: string): boolean {
  if (!extracted || !stored) return false;
  const a = normaliseSupplierName(extracted);
  const b = normaliseSupplierName(stored);
  if (!a || !b) return false;
  if (a === b) return true;
  // Use longer side as haystack to catch "Seafolly" inside "Seafolly Pty Limited"
  // and the reverse if the stored row is the longer one.
  return a.includes(b) || b.includes(a) || a.startsWith(b) || b.startsWith(a);
}

export async function persistParsedInvoice(
  meta: InvoiceMeta,
  products: ValidatedProduct[]
): Promise<{ documentId: string | null; supplierId: string | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { documentId: null, supplierId: null, error: "Not authenticated" };

  const userId = session.user.id;
  const accepted = products.filter(p => !p._rejected);

  // Calculate totals from products if not provided
  const subtotal = meta.subtotal ?? accepted.reduce((sum, p) => sum + (p.cost * p.qty), 0);
  const total = meta.total ?? subtotal;

  // ── 1. Find existing supplier via fuzzy match ─────────────
  let matchedSupplierId: string | null = null;
  if (meta.supplier) {
    const { data: existingSuppliers } = await supabase
      .from("suppliers")
      .select("id, name, total_spend")
      .eq("user_id", userId);

    const match = (existingSuppliers || []).find(s =>
      isFuzzySupplierMatch(meta.supplier, s.name as string)
    );
    if (match) matchedSupplierId = match.id as string;
  }

  // ── 2. Build document_number (use filename as fallback) ───
  const documentNumber =
    meta.invoiceNumber?.trim() ||
    (meta.filename ? meta.filename.replace(/\.[^.]+$/, "") : null);

  // ── 3. Insert document ────────────────────────────────────
  const { data: doc, error: docErr } = await supabase.from("documents").insert({
    user_id: userId,
    source_type: meta.documentType === "packing_slip" ? "packing_slip" : "invoice",
    supplier_id: matchedSupplierId,
    supplier_name: meta.supplier,
    document_number: documentNumber,
    source_filename: meta.filename || null,
    date: meta.invoiceDate || null,
    due_date: meta.dueDate || null,
    currency: meta.currency || "AUD",
    subtotal: subtotal,
    gst: meta.gst ?? 0,
    total: total,
    status: "draft",
  } as any).select("id").single();

  if (docErr || !doc) {
    console.error("Failed to save document:", docErr);
    return { documentId: null, supplierId: matchedSupplierId, error: docErr?.message || "Failed to save document" };
  }

  // ── 4. Insert document lines ──────────────────────────────
  if (accepted.length > 0) {
    const lines = accepted.map(p => ({
      user_id: userId,
      document_id: doc.id,
      product_title: p.name || null,
      sku: p.sku || null,
      color: p.colour || null,
      size: p.size || null,
      quantity: p.qty || 0,
      unit_cost: p.cost || 0,
      total_cost: (p.cost || 0) * (p.qty || 0),
      gst: 0,
      confidence: p._confidence ?? null,
      parse_strategy: p._costSource || "direct",
      accounting_category: null,
      accounting_code: null,
    }));

    const { error: lineErr } = await supabase.from("document_lines").insert(lines);
    if (lineErr) {
      console.error("Failed to save document lines:", lineErr);
    }
  }

  // ── 5. Update or create supplier with rolled-up metrics ───
  if (matchedSupplierId) {
    // Existing supplier — bump spend (other metrics like avg_order /
    // invoice_count are computed live on the SupplierPanel from
    // `documents` rows, so spend is the only stored aggregate).
    const { data: current } = await supabase
      .from("suppliers")
      .select("total_spend")
      .eq("id", matchedSupplierId)
      .maybeSingle();

    const newSpend = (Number(current?.total_spend) || 0) + (total || 0);
    await supabase.from("suppliers").update({
      total_spend: newSpend,
      updated_at: new Date().toISOString(),
    }).eq("id", matchedSupplierId);
  } else if (meta.supplier) {
    // No fuzzy match — create a new supplier
    const { data: newSup } = await supabase.from("suppliers").insert({
      user_id: userId,
      name: meta.supplier,
      contact_info: {},
      currency: meta.currency || "AUD",
      total_spend: total || 0,
    }).select("id").single();

    if (newSup?.id) {
      matchedSupplierId = newSup.id as string;
      // Backfill supplier_id on the document we just inserted
      await supabase.from("documents").update({ supplier_id: matchedSupplierId }).eq("id", doc.id);
    }
  }

  return { documentId: doc.id, supplierId: matchedSupplierId, error: null };
}
