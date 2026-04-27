-- user_saved_reports table for storing filter/column configurations per user
CREATE TABLE public.user_saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  report_key text NOT NULL,           -- e.g. "sku_variants"
  report_name text NOT NULL,
  filter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own saved reports"
ON public.user_saved_reports
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_saved_reports_user_key
  ON public.user_saved_reports(user_id, report_key);

CREATE TRIGGER update_user_saved_reports_updated_at
BEFORE UPDATE ON public.user_saved_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();