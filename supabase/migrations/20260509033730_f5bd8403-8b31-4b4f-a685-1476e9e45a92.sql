CREATE TABLE IF NOT EXISTS public.price_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  shopify_product_id TEXT NOT NULL,
  shopify_variant_id TEXT NOT NULL,
  style_name TEXT,
  sku TEXT,
  vendor TEXT,
  price_before NUMERIC(10,2),
  compare_at_before NUMERIC(10,2),
  price_after NUMERIC(10,2),
  compare_at_after NUMERIC(10,2),
  reason TEXT NOT NULL DEFAULT 'refill_price_restore',
  invoice_number TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'refill',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.price_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own price changes"
  ON public.price_changes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own price changes"
  ON public.price_changes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own price changes"
  ON public.price_changes FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_price_changes_user_created
  ON public.price_changes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_changes_variant
  ON public.price_changes (shopify_variant_id);