
-- ─── shared_supplier_profiles ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_supplier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL,
  supplier_name_normalized text NOT NULL,
  supplier_abn text,
  detected_pattern text,                    -- 'A'..'H'
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  gst_treatment text,                       -- 'inc' | 'ex' | 'nz_inc' | 'unknown'
  has_rrp boolean,
  sku_format text,
  size_in_sku boolean DEFAULT false,
  colour_in_name boolean DEFAULT false,
  contributing_users integer NOT NULL DEFAULT 1,
  total_invoices_processed integer NOT NULL DEFAULT 1,
  avg_correction_rate numeric,
  confidence_score numeric DEFAULT 50,
  is_verified boolean NOT NULL DEFAULT false,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shared_supplier_profiles_name_idx
  ON public.shared_supplier_profiles (supplier_name_normalized);

ALTER TABLE public.shared_supplier_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read shared profiles"
  ON public.shared_supplier_profiles;
CREATE POLICY "Anyone authenticated can read shared profiles"
  ON public.shared_supplier_profiles
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies → only service role (edge functions) can write.

-- ─── user_brain_settings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_brain_settings (
  user_id uuid PRIMARY KEY,
  contribute_shared boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_brain_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own brain settings" ON public.user_brain_settings;
CREATE POLICY "Own brain settings"
  ON public.user_brain_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── supplier_intelligence: pattern + origin + trend ────────
ALTER TABLE public.supplier_intelligence
  ADD COLUMN IF NOT EXISTS detected_pattern text,
  ADD COLUMN IF NOT EXISTS is_shared_origin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_correction_rate numeric;
