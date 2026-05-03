CREATE TABLE IF NOT EXISTS public.validation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  invoice_id text,
  run_at timestamptz NOT NULL DEFAULT now(),
  total_lines int NOT NULL DEFAULT 0,
  price_issues int NOT NULL DEFAULT 0,
  variant_issues int NOT NULL DEFAULT 0,
  sku_issues int NOT NULL DEFAULT 0,
  catalog_issues int NOT NULL DEFAULT 0,
  published_with_warnings boolean NOT NULL DEFAULT false,
  details jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_validation_runs_user ON public.validation_runs(user_id, run_at DESC);

ALTER TABLE public.validation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own validation runs"
  ON public.validation_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own validation runs"
  ON public.validation_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
