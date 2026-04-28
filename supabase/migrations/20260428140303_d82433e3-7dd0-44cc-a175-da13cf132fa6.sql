ALTER TABLE public.invoice_processing_jobs
  ADD COLUMN IF NOT EXISTS request_payload jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE public.invoice_processing_jobs
  DROP CONSTRAINT IF EXISTS invoice_processing_jobs_status_check;

ALTER TABLE public.invoice_processing_jobs
  ADD CONSTRAINT invoice_processing_jobs_status_check
  CHECK (status IN ('pending','queued','running','done','failed'));

CREATE INDEX IF NOT EXISTS idx_invoice_processing_jobs_kind_status
  ON public.invoice_processing_jobs (job_kind, status, created_at DESC);