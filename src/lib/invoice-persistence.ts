// ══════════════════════════════════════════════════════════
// Invoice DB Persistence — saves parsed invoices to the
// documents + document_lines tables, and updates the
// matched supplier's performance metrics (spend, last
// invoice date, link to supplier_id).
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";
import type { ValidatedProduct } from "./invoice-validator";
import { expandLineBySize, isSizeRun } from "./size-run-expander";

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
  products: ValidatedProduct[],
  runId?: string | null,
): Promise<{ documentId: string | null; supplierId: string | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { documentId: null, supplierId: null, error: "Not authenticated" };

  const userId = session.user.id;
  // ── Enrich phase: split size-run lines (e.g. size "8-16") into one
  //    discrete variant per size BEFORE persisting. Without this, the
  //    DB stores a single variant with size="8-16" and downstream
  //    pricing / publishing tools can't address individual sizes.
  //    Quantity is divided across the run; SKUs get a "-{size}" suffix.
  //    See: src/lib/size-run-expander.ts (expandLineBySize).
  const acceptedRaw = products.filter(p => !p._rejected);
  let sizeRunsExpanded = 0;
  const accepted: ValidatedProduct[] = acceptedRaw.flatMap((p) => {
    if (!isSizeRun(p.size || "")) return [p];
    const split = expandLineBySize(p);
    if (split.length > 1) sizeRunsExpanded += split.length - 1;
    // expandLineBySize preserves the spread, so the ValidatedProduct
    // metadata (_confidence, _suggestedTitle, etc.) carries through.
    return split as ValidatedProduct[];
  });
  if (sizeRunsExpanded > 0) {
    console.log(`[invoice-persistence] enrich: expanded ${sizeRunsExpanded} extra size variants from runs`);
  }


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

  // ── 4b. Upsert into products + variants so pricing tools (Price
  //        Adjustment, Margin Protection, Markdown Ladder) can see
  //        the newly-processed invoice products. Without this, those
  //        tools only ever show demo rows.
  const writtenProductIds: string[] = [];
  try {
    // Group accepted lines by product title (variants share a product)
    const byTitle = new Map<string, ValidatedProduct[]>();
    for (const p of accepted) {
      const title = (p.name || "Untitled product").trim();
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title)!.push(p);
    }

    for (const [title, lines] of byTitle.entries()) {
      // 1. Find-or-create product. The unique index is
      //    (user_id, lower(title), COALESCE(vendor, '')) so we must
      //    match case-insensitively on title AND filter by vendor.
      let productId: string | null = null;
      const vendorVal = meta.supplier || null;

      const findExisting = async (): Promise<string | null> => {
        let q = supabase
          .from("products")
          .select("id")
          .eq("user_id", userId)
          .ilike("title", title);
        q = vendorVal ? q.eq("vendor", vendorVal) : q.is("vendor", null);
        const { data } = await q.maybeSingle();
        return (data?.id as string) || null;
      };

      productId = await findExisting();

      if (productId) {
        await supabase.from("products").update({
          vendor: vendorVal,
          source: "invoice_unreviewed",
          updated_at: new Date().toISOString(),
        } as any).eq("id", productId);
      } else {
        const { data: newProduct, error: prodErr } = await supabase
          .from("products")
          .insert({
            user_id: userId,
            title,
            vendor: vendorVal,
            source: "invoice_unreviewed",
          } as any)
          .select("id")
          .single();
        if (prodErr) {
          // Race / casing mismatch — re-query and reuse existing row.
          console.warn("[invoice-persistence] product insert failed, re-querying:", prodErr.message);
          productId = await findExisting();
          if (!productId) {
            console.warn("[invoice-persistence] could not resolve product after conflict, skipping:", title);
            continue;
          }
        } else {
          productId = newProduct?.id as string;
        }
      }
      if (!productId) continue;
      writtenProductIds.push(productId);

      // 2. Upsert each variant. variants_user_sku_unique covers (user_id, sku)
      //    where sku is non-empty — fall back to insert when sku is blank.
      for (const line of lines) {
        const sku = (line.sku || "").trim();
        const cost = Number(line.cost) || 0;
        const rrp = Number(line.rrp) || 0;
        // RRP fallback: if missing, default to cost * 2.5 so the row still
        // appears in pricing tools (better than retail_price = 0).
        const retailPrice = rrp > 0 ? rrp : cost > 0 ? +(cost * 2.5).toFixed(2) : 0;

        if (sku) {
          // Upsert by (user_id, sku) — matches the partial unique index
          await supabase
            .from("variants")
            .upsert({
              user_id: userId,
              product_id: productId,
              sku,
              color: line.colour || null,
              size: line.size || null,
              quantity: Number(line.qty) || 0,
              cost,
              retail_price: retailPrice,
            } as any, { onConflict: "user_id,sku" });
        } else {
          // No SKU — find existing by product+colour+size or insert new
          const { data: existingVar } = await supabase
            .from("variants")
            .select("id")
            .eq("user_id", userId)
            .eq("product_id", productId)
            .eq("color", line.colour || "")
            .eq("size", line.size || "")
            .maybeSingle();
          if (existingVar?.id) {
            await supabase.from("variants").update({
              cost,
              retail_price: retailPrice,
              quantity: Number(line.qty) || 0,
              updated_at: new Date().toISOString(),
            } as any).eq("id", existingVar.id as string);
          } else {
            await supabase.from("variants").insert({
              user_id: userId,
              product_id: productId,
              color: line.colour || null,
              size: line.size || null,
              quantity: Number(line.qty) || 0,
              cost,
              retail_price: retailPrice,
            } as any);
          }
        }
      }
    }
  } catch (e) {
    console.error("[invoice-persistence] product/variant upsert failed:", e);
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

  // ── 6. Fire Agent 3 (Enrichment) in the background — do NOT await.
  //        The Review screen subscribes to products UPDATE events and
  //        renders descriptions/images live as they arrive.
  if (writtenProductIds.length > 0) {
    console.log(
      "[persistence] calling auto-enrich with",
      writtenProductIds.length,
      "ids:",
      writtenProductIds,
    );
    supabase.functions.invoke("auto-enrich", {
      body: {
        user_id: userId,
        product_ids: writtenProductIds,
        run_id: runId ?? null,
      },
    }).then((r) => {
      console.log(
        "[auto-enrich] invoke response:",
        JSON.stringify(r?.data),
        "error:",
        r?.error?.message,
      );
    }).catch((e) => {
      console.warn("[auto-enrich] invoke threw:", e?.message);
    });
  }

  // ── 7. Fire Agent 5 (Learning) — also background, never await.
  //        Reads correction_log + document_lines server-side to compute
  //        the per-invoice correction rate, then updates user + shared
  //        supplier profiles for cross-client intelligence.
  if (meta.supplier && doc.id) {
    console.log("[persistence] calling learning-agent for", meta.supplier);
    supabase.functions.invoke("learning-agent", {
      body: {
        user_id: userId,
        supplier_name: meta.supplier,
        document_id: doc.id,
      },
    }).then((r) => {
      console.log("[learning] complete:", JSON.stringify(r?.data), "error:", r?.error?.message);
    }).catch((e) => {
      console.warn("[learning] invoke threw:", e?.message);
    });
  }

  return { documentId: doc.id, supplierId: matchedSupplierId, error: null };
}
