-- Per-user brand database
CREATE TABLE IF NOT EXISTS public.brand_database (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  canonical_brand_name text,
  website_url text,
  is_shopify boolean NOT NULL DEFAULT false,
  products_json_endpoint text,
  country_origin text,
  product_categories text,
  verified_date date,
  notes text,
  enrichment_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand_name)
);

CREATE INDEX IF NOT EXISTS idx_brand_database_user ON public.brand_database(user_id);
CREATE INDEX IF NOT EXISTS idx_brand_database_brand_lower ON public.brand_database(user_id, lower(brand_name));
CREATE INDEX IF NOT EXISTS idx_brand_database_canonical_lower ON public.brand_database(user_id, lower(canonical_brand_name));

ALTER TABLE public.brand_database ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own brand_database"
  ON public.brand_database FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own brand_database"
  ON public.brand_database FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own brand_database"
  ON public.brand_database FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own brand_database"
  ON public.brand_database FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_brand_database_updated_at
  BEFORE UPDATE ON public.brand_database
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-user sync log
CREATE TABLE IF NOT EXISTS public.brand_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  synced_at timestamptz NOT NULL DEFAULT now(),
  source_url text,
  rows_inserted int NOT NULL DEFAULT 0,
  rows_updated int NOT NULL DEFAULT 0,
  rows_skipped int NOT NULL DEFAULT 0,
  rows_errored int NOT NULL DEFAULT 0,
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by text NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_brand_sync_log_user_time
  ON public.brand_sync_log(user_id, synced_at DESC);

ALTER TABLE public.brand_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own brand_sync_log"
  ON public.brand_sync_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own brand_sync_log"
  ON public.brand_sync_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Per-user settings (currently just brand_sync_url)
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_sync_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own user_settings"
  ON public.user_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own user_settings"
  ON public.user_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own user_settings"
  ON public.user_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();