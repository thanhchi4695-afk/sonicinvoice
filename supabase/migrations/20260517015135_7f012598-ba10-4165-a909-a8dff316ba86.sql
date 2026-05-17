ALTER TABLE public.auto_test_hypotheses
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS deployed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.auto_test_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  hypothesis_id uuid NOT NULL REFERENCES public.auto_test_hypotheses(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor text NOT NULL,
  actor_user_id uuid,
  snapshot jsonb DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ata_user ON public.auto_test_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ata_hyp ON public.auto_test_audit(hypothesis_id, created_at DESC);
ALTER TABLE public.auto_test_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select audit" ON public.auto_test_audit FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert audit" ON public.auto_test_audit FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "svc all audit" ON public.auto_test_audit FOR ALL TO service_role USING (true) WITH CHECK (true);