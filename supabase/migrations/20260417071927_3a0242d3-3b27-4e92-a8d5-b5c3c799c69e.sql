
-- ── Extend existing supplier_profiles table ─────────────────────────
ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS supplier_name_variants text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'AU',
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'AUD',
  ADD COLUMN IF NOT EXISTS invoice_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_known_brand boolean DEFAULT false;

-- ── invoice_patterns ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_profile_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  format_type text,
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_system text,
  price_column_cost text,
  price_column_rrp text,
  gst_included_in_cost boolean,
  gst_included_in_rrp boolean,
  default_markup_multiplier numeric,
  pack_notation_detected boolean DEFAULT false,
  size_matrix_detected boolean DEFAULT false,
  sample_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoice_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own invoice patterns"
  ON public.invoice_patterns FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_patterns_supplier ON public.invoice_patterns(supplier_profile_id);
CREATE INDEX IF NOT EXISTS idx_invoice_patterns_user ON public.invoice_patterns(user_id);

CREATE TRIGGER update_invoice_patterns_updated_at
  BEFORE UPDATE ON public.invoice_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── brand_patterns ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_profile_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name text,
  sku_prefix_pattern text,
  sku_format_regex text,
  size_scale_examples jsonb NOT NULL DEFAULT '{}'::jsonb,
  colour_column_name text,
  product_type_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  special_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own brand patterns"
  ON public.brand_patterns FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_brand_patterns_supplier ON public.brand_patterns(supplier_profile_id);
CREATE INDEX IF NOT EXISTS idx_brand_patterns_user ON public.brand_patterns(user_id);

-- ── correction_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.correction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_profile_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_pattern_id uuid REFERENCES public.invoice_patterns(id) ON DELETE SET NULL,
  field_corrected text,
  original_value text,
  corrected_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own correction log"
  ON public.correction_log FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_correction_log_supplier ON public.correction_log(supplier_profile_id);
CREATE INDEX IF NOT EXISTS idx_correction_log_user ON public.correction_log(user_id);
