CREATE TABLE public.parse_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  supplier_name TEXT,
  source TEXT,
  input_file_ref TEXT,
  input_filename TEXT,
  input_mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence TEXT,
  stage1_output JSONB,
  stage2_output JSONB,
  stage3_output JSONB,
  output_rows JSONB,
  field_completeness NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parse_jobs_status_check CHECK (status IN ('pending','processing','done','failed')),
  CONSTRAINT parse_jobs_confidence_check CHECK (confidence IS NULL OR confidence IN ('high','medium','low'))
);

CREATE INDEX idx_parse_jobs_user_created ON public.parse_jobs (user_id, created_at DESC);
CREATE INDEX idx_parse_jobs_status ON public.parse_jobs (status);

ALTER TABLE public.parse_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own parse jobs"
  ON public.parse_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own parse jobs"
  ON public.parse_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own parse jobs"
  ON public.parse_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own parse jobs"
  ON public.parse_jobs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_parse_jobs_updated_at
  BEFORE UPDATE ON public.parse_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();