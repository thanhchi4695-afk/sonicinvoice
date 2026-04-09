// ══════════════════════════════════════════════════════════
// Invoice DB Persistence — saves parsed invoices to the
// documents + document_lines tables for audit trail and
// cross-module integration.
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
}

export async function persistParsedInvoice(
  meta: InvoiceMeta,
  products: ValidatedProduct[]
): Promise<{ documentId: string | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { documentId: null, error: "Not authenticated" };

  const userId = session.user.id;
  const accepted = products.filter(p => !p._rejected);

  // Calculate totals from products if not provided
  const subtotal = meta.subtotal ?? accepted.reduce((sum, p) => sum + (p.cost * p.qty), 0);
  const total = meta.total ?? subtotal;

  // Insert document
  const { data: doc, error: docErr } = await supabase.from("documents").insert({
    user_id: userId,
    source_type: meta.documentType === "packing_slip" ? "packing_slip" : "invoice",
    supplier_name: meta.supplier,
    document_number: meta.invoiceNumber || null,
    date: meta.invoiceDate || null,
    due_date: meta.dueDate || null,
    currency: meta.currency || "AUD",
    subtotal: subtotal,
    gst: meta.gst ?? 0,
    total: total,
    status: "draft",
  }).select("id").single();

  if (docErr || !doc) {
    console.error("Failed to save document:", docErr);
    return { documentId: null, error: docErr?.message || "Failed to save document" };
  }

  // Insert document lines
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
      confidence: p._confidence,
      parse_strategy: p._costSource || "direct",
      accounting_category: null,
      accounting_code: null,
    }));

    const { error: lineErr } = await supabase.from("document_lines").insert(lines);
    if (lineErr) {
      console.error("Failed to save document lines:", lineErr);
    }
  }

  // Auto-create or update supplier
  const { data: existingSupplier } = await supabase
    .from("suppliers")
    .select("id, total_spend")
    .eq("user_id", userId)
    .ilike("name", meta.supplier)
    .maybeSingle();

  if (!existingSupplier && meta.supplier) {
    await supabase.from("suppliers").insert({
      user_id: userId,
      name: meta.supplier,
      contact_info: {},
      currency: meta.currency || "AUD",
      total_spend: total || 0,
    });
  } else if (existingSupplier && total) {
    const newSpend = (Number(existingSupplier.total_spend) || 0) + total;
    await supabase.from("suppliers").update({
      total_spend: newSpend,
    }).eq("id", existingSupplier.id);
  }

  return { documentId: doc.id, error: null };
}
