ALTER TABLE public.parse_jobs
  ADD COLUMN IF NOT EXISTS shopify_import_result JSONB;

ALTER TABLE public.parse_jobs DROP CONSTRAINT IF EXISTS parse_jobs_status_check;
ALTER TABLE public.parse_jobs
  ADD CONSTRAINT parse_jobs_status_check
  CHECK (status IN ('pending','processing','done','failed','imported','import_failed'));