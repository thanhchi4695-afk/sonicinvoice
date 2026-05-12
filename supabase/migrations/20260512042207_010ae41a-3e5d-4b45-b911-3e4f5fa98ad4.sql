
CREATE TABLE public.drive_watch_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  folder_id text NOT NULL,
  folder_name text,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drive_watch_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own drive settings" ON public.drive_watch_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own drive settings" ON public.drive_watch_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own drive settings" ON public.drive_watch_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own drive settings" ON public.drive_watch_settings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER drive_watch_settings_updated_at
  BEFORE UPDATE ON public.drive_watch_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.drive_ingested_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  drive_file_id text NOT NULL,
  drive_file_name text,
  mime_type text,
  parse_job_id uuid,
  status text NOT NULL DEFAULT 'queued',
  error text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, drive_file_id)
);

CREATE INDEX idx_drive_ingested_user ON public.drive_ingested_files(user_id, ingested_at DESC);

ALTER TABLE public.drive_ingested_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own drive ingestion" ON public.drive_ingested_files
  FOR SELECT USING (auth.uid() = user_id);
