-- Corrections capture log: training data for the grader rubric and Claude Managed Agents Dreaming
CREATE TABLE IF NOT EXISTS public.corrections (
  id                    UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID NOT NULL,
  invoice_job_id        UUID REFERENCES public.invoice_processing_jobs(id) ON DELETE SET NULL,
  supplier_key          TEXT NOT NULL,
  shopify_vendor        TEXT,
  sku                   TEXT,
  style_name            TEXT,
  field_corrected       TEXT NOT NULL,
  value_before          TEXT,
  value_after           TEXT,
  correction_type       TEXT NOT NULL,
  grader_score_before   INTEGER,
  extractor_used        TEXT,
  invoice_date          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_supplier ON public.corrections(supplier_key);
CREATE INDEX IF NOT EXISTS idx_corrections_field    ON public.corrections(field_corrected);
CREATE INDEX IF NOT EXISTS idx_corrections_created  ON public.corrections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_user     ON public.corrections(user_id, created_at DESC);

ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own corrections"
  ON public.corrections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own corrections"
  ON public.corrections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own corrections"
  ON public.corrections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own corrections"
  ON public.corrections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role (edge functions) can read everyone's corrections to feed the grader rubric
CREATE POLICY "Service role full access"
  ON public.corrections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);