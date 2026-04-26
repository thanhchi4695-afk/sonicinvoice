ALTER TABLE public.product_catalog_cache
  ADD COLUMN IF NOT EXISTS vendor text;

CREATE INDEX IF NOT EXISTS product_catalog_cache_user_vendor_idx
  ON public.product_catalog_cache (user_id, lower(vendor));