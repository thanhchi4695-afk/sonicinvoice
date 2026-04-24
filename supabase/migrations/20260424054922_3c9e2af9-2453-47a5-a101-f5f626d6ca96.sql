
-- 1. Augment supplier_websites with sync metadata + extra brand fields
ALTER TABLE public.supplier_websites
  ADD COLUMN IF NOT EXISTS last_modified_by text NOT NULL DEFAULT 'admin_ui'
    CHECK (last_modified_by IN ('sheet', 'admin_ui', 'system')),
  ADD COLUMN IF NOT EXISTS source_sheet_row_id text,
  ADD COLUMN IF NOT EXISTS canonical_brand_name text,
  ADD COLUMN IF NOT EXISTS country_origin text,
  ADD COLUMN IF NOT EXISTS product_categories text;

-- Replace the generic updated_at trigger with one that also handles last_modified_by
DROP TRIGGER IF EXISTS trg_supplier_websites_updated_at ON public.supplier_websites;

CREATE OR REPLACE FUNCTION public.bump_supplier_websites_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  -- If the writer didn't explicitly set last_modified_by to 'sheet' or 'system',
  -- assume this is a UI edit
  IF NEW.last_modified_by IS NULL OR NEW.last_modified_by = OLD.last_modified_by THEN
    IF NEW.last_modified_by IS DISTINCT FROM 'sheet'
       AND NEW.last_modified_by IS DISTINCT FROM 'system' THEN
      NEW.last_modified_by = 'admin_ui';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_websites_updated_at
  BEFORE UPDATE ON public.supplier_websites
  FOR EACH ROW EXECUTE FUNCTION public.bump_supplier_websites_updated_at();

-- 2. Sync log
CREATE TABLE IF NOT EXISTS public.supplier_websites_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('manual', 'cron')),
  sheet_url text,
  rows_in_sheet integer,
  rows_upserted integer,
  rows_skipped_db_newer integer,
  rows_skipped_no_change integer,
  rows_failed integer,
  error_text text,
  duration_ms integer,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'error'))
);

ALTER TABLE public.supplier_websites_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read sync log"
  ON public.supplier_websites_sync_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Inserts come from the edge function via service role (bypasses RLS)

-- 3. Global app settings (single row)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,  -- ensures only one row
  brand_sync_sheet_url text,
  brand_sync_schedule text NOT NULL DEFAULT 'monthly'
    CHECK (brand_sync_schedule IN ('monthly', 'weekly', 'daily', 'manual')),
  brand_sync_last_run_at timestamptz,
  brand_sync_last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (singleton = true)
);

INSERT INTO public.app_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read app settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update app settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Schedule monthly sync (1st of month at 02:00 AEST = 16:00 UTC prior day)
-- We use day 1 at 16:00 UTC for simplicity (= 02:00 / 03:00 AEST depending on DST)
SELECT cron.schedule(
  'sync-supplier-websites-monthly',
  '0 16 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/sync-supplier-websites',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54'
    ),
    body := jsonb_build_object('source', 'cron')
  ) AS request_id;
  $$
);
