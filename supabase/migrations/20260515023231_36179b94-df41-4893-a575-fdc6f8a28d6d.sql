
CREATE TABLE IF NOT EXISTS public.auto_ingest_settings (
  user_id uuid PRIMARY KEY,
  gmail_enabled boolean NOT NULL DEFAULT false,
  gmail_query text NOT NULL DEFAULT 'has:attachment filename:pdf (invoice OR receipt OR statement)',
  gmail_last_history_id text,
  gmail_last_polled_at timestamptz,
  drive_enabled boolean NOT NULL DEFAULT false,
  drive_folder_id text,
  drive_folder_name text,
  drive_last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_ingest_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ais_select_own" ON public.auto_ingest_settings;
DROP POLICY IF EXISTS "ais_insert_own" ON public.auto_ingest_settings;
DROP POLICY IF EXISTS "ais_update_own" ON public.auto_ingest_settings;
DROP POLICY IF EXISTS "ais_delete_own" ON public.auto_ingest_settings;
CREATE POLICY "ais_select_own" ON public.auto_ingest_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ais_insert_own" ON public.auto_ingest_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ais_update_own" ON public.auto_ingest_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ais_delete_own" ON public.auto_ingest_settings FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_ais_updated ON public.auto_ingest_settings;
CREATE TRIGGER trg_ais_updated
BEFORE UPDATE ON public.auto_ingest_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
