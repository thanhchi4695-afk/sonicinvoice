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
  barcode?: string;
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

  const valid = items.filter((i) => (i.product_title || "").trim().length > 0);

  await Promise.all(valid.map(async (item) => {
    try {
      const title = item.product_title.trim();
      const vendor = (item.vendor || "").trim() || null;
      const colour = (item.colour || "").trim() || null;
      const size = (item.size || "").trim() || null;
      const sku = (item.sku || "").trim();

      let productLookup = supabase
        .from("products")
        .select("id")
        .eq("user_id", userId)
        .eq("title", title)
        .limit(1);

      const { data: existingProduct, error: productLookupError } = vendor
        ? await productLookup.eq("vendor", vendor).maybeSingle()
        : await productLookup.is("vendor", null).maybeSingle();

      if (productLookupError) throw productLookupError;

      let productId = existingProduct?.id as string | undefined;
      if (!productId) {
        const { data: createdProduct, error: productInsertError } = await supabase
          .from("products")
          .insert({
            user_id: userId,
            title,
            vendor,
          })
          .select("id")
          .single();

        if (productInsertError || !createdProduct?.id) {
          throw productInsertError ?? new Error(`Could not create product for ${title}`);
        }
        productId = createdProduct.id;
      }

      const variantPayload = {
        user_id: userId,
        product_id: productId,
        sku: sku || null,
        barcode: (item.barcode || "").trim() || null,
        color: colour,
        size,
        cost: Number(item.unit_cost) || 0,
        retail_price: Number(item.rrp) || 0,
        quantity: Number(item.qty) || 0,
      };

      if (sku) {
        const { data: existingVariant, error: variantLookupError } = await supabase
          .from("variants")
          .select("id")
          .eq("user_id", userId)
          .eq("sku", sku)
          .limit(1)
          .maybeSingle();

        if (variantLookupError) throw variantLookupError;

        if (existingVariant?.id) {
          const { error: variantUpdateError } = await supabase
            .from("variants")
            .update(variantPayload)
            .eq("id", existingVariant.id);
          if (variantUpdateError) throw variantUpdateError;
        } else {
          const { error: variantInsertError } = await supabase
            .from("variants")
            .insert(variantPayload);
          if (variantInsertError) throw variantInsertError;
        }
      } else {
        let variantLookup = supabase
          .from("variants")
          .select("id")
          .eq("user_id", userId)
          .eq("product_id", productId)
          .limit(1);

        variantLookup = colour ? variantLookup.eq("color", colour) : variantLookup.is("color", null);
        variantLookup = size ? variantLookup.eq("size", size) : variantLookup.is("size", null);

        const { data: existingVariant, error: variantLookupError } = await variantLookup.maybeSingle();
        if (variantLookupError) throw variantLookupError;

        if (existingVariant?.id) {
          const { error: variantUpdateError } = await supabase
            .from("variants")
            .update(variantPayload)
            .eq("id", existingVariant.id);
          if (variantUpdateError) throw variantUpdateError;
        } else {
          const { error: variantInsertError } = await supabase
            .from("variants")
            .insert(variantPayload);
          if (variantInsertError) throw variantInsertError;
        }
      }

      result.written += 1;
    } catch (e: any) {
      result.failed += 1;
      result.errors.push(e?.message || "unknown");
    }
  }));

  return result;
}
