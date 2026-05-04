CREATE TABLE public.misclassification_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  detected_supplier text NOT NULL,
  expected_from_filename text NOT NULL,
  invoice_id uuid NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz NULL,
  resolution text NULL
);

ALTER TABLE public.misclassification_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own misclassification alerts"
  ON public.misclassification_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own misclassification alerts"
  ON public.misclassification_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own misclassification alerts"
  ON public.misclassification_alerts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own misclassification alerts"
  ON public.misclassification_alerts FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_misclass_alerts_user_unresolved
  ON public.misclassification_alerts (user_id, alerted_at DESC)
  WHERE resolved = false;