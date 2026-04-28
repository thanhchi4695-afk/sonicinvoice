
CREATE TABLE public.invoice_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_kind text NOT NULL DEFAULT 'ocr_upgrade',
  file_name text,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT invoice_processing_jobs_status_check
    CHECK (status IN ('pending','running','done','failed'))
);

CREATE INDEX idx_invoice_processing_jobs_user_status
  ON public.invoice_processing_jobs (user_id, status, created_at DESC);

ALTER TABLE public.invoice_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own invoice processing jobs"
  ON public.invoice_processing_jobs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role inserts/updates from edge functions
CREATE POLICY "Service role manages invoice processing jobs"
  ON public.invoice_processing_jobs
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_invoice_processing_jobs_updated_at
  BEFORE UPDATE ON public.invoice_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_processing_jobs;
