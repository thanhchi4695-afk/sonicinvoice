// ══════════════════════════════════════════════════════════
// Invoice → Catalog Sync
// Writes extracted invoice products into the products and
// variants tables so downstream pricing tools (Price
// Adjustment, Margin Protection, Markdown Ladder) can read
// them immediately after extraction completes.
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";

export interface InvoiceCatalogItem {
  product_title: string;
  vendor?: string;
  sku?: string;
  colour?: string;
  size?: string;
  unit_cost?: number;
  rrp?: number;
  qty?: number;
}

export interface SyncResult {
  written: number;
  failed: number;
  errors: string[];
}

/**
 * Upserts each item as a product+variant pair in parallel.
 * Returns counts so the caller can show feedback. Best-effort —
 * individual failures are logged, not thrown.
 */
export async function syncInvoiceItemsToCatalog(
  items: InvoiceCatalogItem[],
): Promise<SyncResult> {
  const result: SyncResult = { written: 0, failed: 0, errors: [] };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    result.errors.push("Not authenticated");
    return result;
  }
  const userId = user.id;

  // Skip rows without a usable title.
  const valid = items.filter(i => (i.product_title || "").trim().length > 0);

  await Promise.all(valid.map(async (item) => {
    try {
      const title = item.product_title.trim();
      const vendor = (item.vendor || "").trim() || null;

      // ── Upsert product (dedupe by user+title+vendor) ───
      const { data: prod, error: prodErr } = await supabase
        .from("products")
        .upsert(
          {
            user_id: userId,
            title,
            vendor,
          },
          { onConflict: "user_id,title,vendor", ignoreDuplicates: false },
        )
        .select("id")
        .single();

      // Fallback: if upsert with onConflict fails (constraint name mismatch),
      // try select-then-insert.
      let productId = prod?.id as string | undefined;
      if (prodErr || !productId) {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("user_id", userId)
          .eq("title", title)
          .maybeSingle();
        if (existing?.id) {
          productId = existing.id;
        } else {
          const { data: created } = await supabase
            .from("products")
            .insert({ user_id: userId, title, vendor })
            .select("id")
            .single();
          productId = created?.id;
        }
      }
      if (!productId) {
        result.failed += 1;
        return;
      }

      // ── Upsert variant ─────────────────────────────────
      const sku = (item.sku || "").trim();
      const variantPayload = {
        user_id: userId,
        product_id: productId,
        sku: sku || null,
        color: item.colour || null,
        size: item.size || null,
        cost: Number(item.unit_cost) || 0,
        retail_price: Number(item.rrp) || 0,
        quantity: Number(item.qty) || 0,
      };

      if (sku) {
        const { error: vErr } = await supabase
          .from("variants")
          .upsert(variantPayload, { onConflict: "user_id,sku", ignoreDuplicates: false });
        if (vErr) {
          // Fallback: manual update or insert
          const { data: existingV } = await supabase
            .from("variants")
            .select("id")
            .eq("user_id", userId)
            .eq("sku", sku)
            .maybeSingle();
          if (existingV?.id) {
            await supabase.from("variants").update(variantPayload).eq("id", existingV.id);
          } else {
            await supabase.from("variants").insert(variantPayload);
          }
        }
      } else {
        // No SKU — just insert (cannot dedupe).
        await supabase.from("variants").insert(variantPayload);
      }

      result.written += 1;
    } catch (e: any) {
      result.failed += 1;
      result.errors.push(e?.message || "unknown");
    }
  }));

  return result;
}
