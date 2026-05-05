
-- Extend existing brand_patterns
ALTER TABLE public.brand_patterns
  ADD COLUMN IF NOT EXISTS supplier_sku_format TEXT,
  ADD COLUMN IF NOT EXISTS size_schema TEXT,
  ADD COLUMN IF NOT EXISTS price_band_min NUMERIC,
  ADD COLUMN IF NOT EXISTS price_band_max NUMERIC,
  ADD COLUMN IF NOT EXISTS invoice_layout_fingerprint JSONB,
  ADD COLUMN IF NOT EXISTS sample_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accuracy_rate NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique (user_id, brand_name) for upsert; allow only when brand_name set
CREATE UNIQUE INDEX IF NOT EXISTS uniq_brand_patterns_user_brand
  ON public.brand_patterns (user_id, lower(brand_name))
  WHERE brand_name IS NOT NULL;

DROP TRIGGER IF EXISTS trg_brand_patterns_updated ON public.brand_patterns;
CREATE TRIGGER trg_brand_patterns_updated BEFORE UPDATE ON public.brand_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- New brand_stats table
CREATE TABLE IF NOT EXISTS public.brand_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  total_invoices_parsed INTEGER NOT NULL DEFAULT 0,
  avg_accuracy NUMERIC NOT NULL DEFAULT 1.0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand_name)
);
CREATE INDEX IF NOT EXISTS idx_brand_stats_user_brand
  ON public.brand_stats (user_id, lower(brand_name));
ALTER TABLE public.brand_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own brand_stats" ON public.brand_stats FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own brand_stats" ON public.brand_stats FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own brand_stats" ON public.brand_stats FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own brand_stats" ON public.brand_stats FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_brand_stats_updated BEFORE UPDATE ON public.brand_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Hybrid: brand_name on correction_log
ALTER TABLE public.correction_log ADD COLUMN IF NOT EXISTS brand_name TEXT;
CREATE INDEX IF NOT EXISTS idx_correction_log_brand
  ON public.correction_log (user_id, lower(brand_name));
