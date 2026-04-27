
-- Add restock_status to product_catalog_cache (default 'ongoing')
ALTER TABLE public.product_catalog_cache
  ADD COLUMN IF NOT EXISTS restock_status text NOT NULL DEFAULT 'ongoing'
    CHECK (restock_status IN ('ongoing', 'refill', 'no_reorder'));

CREATE INDEX IF NOT EXISTS idx_pcc_user_restock_status
  ON public.product_catalog_cache(user_id, restock_status);

-- Variant-level overrides so cache refreshes don't lose staff tags
CREATE TABLE IF NOT EXISTS public.restock_status_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'shopify',
  platform_variant_id text NOT NULL,
  shop_domain text,
  restock_status text NOT NULL CHECK (restock_status IN ('ongoing', 'refill', 'no_reorder')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (user_id, platform, platform_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_rso_user_variant
  ON public.restock_status_override(user_id, platform_variant_id);

ALTER TABLE public.restock_status_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own restock overrides" ON public.restock_status_override;
CREATE POLICY "Own restock overrides"
  ON public.restock_status_override
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_restock_status_override_updated_at ON public.restock_status_override;
CREATE TRIGGER update_restock_status_override_updated_at
  BEFORE UPDATE ON public.restock_status_override
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
