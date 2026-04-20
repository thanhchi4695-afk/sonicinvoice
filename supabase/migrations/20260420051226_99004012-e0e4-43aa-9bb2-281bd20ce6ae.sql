-- Add unique constraints needed for upsert-by-sku from invoice extraction.
-- Partial indexes (where sku is not null) avoid clashing with existing rows that have NULL skus.

CREATE UNIQUE INDEX IF NOT EXISTS products_user_sku_unique
  ON public.products (user_id, lower(title), coalesce(vendor, ''))
  WHERE title IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS variants_user_sku_unique
  ON public.variants (user_id, sku)
  WHERE sku IS NOT NULL AND sku <> '';
