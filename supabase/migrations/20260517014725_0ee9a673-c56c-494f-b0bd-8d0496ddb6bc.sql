-- Phase 4: Cross-Loop Learning

CREATE TABLE public.cross_loop_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  signal_type text NOT NULL,
  source_optimizer text NOT NULL,
  collection_id text,
  product_id text,
  variant_id text,
  signal_value double precision,
  revenue_impact_estimate double precision,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cls_user ON public.cross_loop_signals(user_id, created_at DESC);
CREATE INDEX idx_cls_source ON public.cross_loop_signals(source_optimizer, created_at DESC);
ALTER TABLE public.cross_loop_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.cross_loop_signals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.cross_loop_signals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "svc insert" ON public.cross_loop_signals FOR INSERT TO service_role WITH CHECK (true);

CREATE TABLE public.business_impact_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  metric_name text NOT NULL,
  weight double precision NOT NULL DEFAULT 1.0,
  sample_size integer NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_name)
);
ALTER TABLE public.business_impact_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.business_impact_weights FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own upsert" ON public.business_impact_weights FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.business_impact_weights FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.business_impact_weights FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.auto_test_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  hypothesis_type text NOT NULL,
  target_id text NOT NULL,
  target_label text,
  current_value text,
  proposed_value text,
  reasoning text,
  expected_impact_pct double precision,
  confidence double precision,
  status text NOT NULL DEFAULT 'pending',
  experiment_id uuid,
  auto_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ath_user ON public.auto_test_hypotheses(user_id, status, created_at DESC);
ALTER TABLE public.auto_test_hypotheses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.auto_test_hypotheses FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.auto_test_hypotheses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.auto_test_hypotheses FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.auto_test_hypotheses FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.auto_test_hypotheses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ath_upd BEFORE UPDATE ON public.auto_test_hypotheses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.cross_loop_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  conflicting_optimizers text[] NOT NULL,
  conflict_summary text,
  resolution_action text NOT NULL,
  net_impact_score double precision,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clr_user ON public.cross_loop_resolutions(user_id, created_at DESC);
ALTER TABLE public.cross_loop_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.cross_loop_resolutions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.cross_loop_resolutions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.cross_loop_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  signals_collected integer DEFAULT 0,
  conflicts_resolved integer DEFAULT 0,
  hypotheses_generated integer DEFAULT 0,
  auto_tests_created integer DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX idx_clrl_user ON public.cross_loop_run_log(user_id, started_at DESC);
ALTER TABLE public.cross_loop_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.cross_loop_run_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.cross_loop_run_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.ai_brain_settings (
  user_id uuid PRIMARY KEY,
  autonomous_enabled boolean NOT NULL DEFAULT false,
  max_concurrent_auto_tests integer NOT NULL DEFAULT 3,
  auto_rollback_enabled boolean NOT NULL DEFAULT true,
  min_confidence_for_auto double precision NOT NULL DEFAULT 0.9,
  revenue_drop_floor_pct double precision NOT NULL DEFAULT 0.05,
  excluded_targets text[] NOT NULL DEFAULT '{}',
  notify_email boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_brain_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own all" ON public.ai_brain_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.ai_brain_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_abs_upd BEFORE UPDATE ON public.ai_brain_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_brain_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  insight_text text NOT NULL,
  category text,
  evidence jsonb DEFAULT '{}'::jsonb,
  confidence double precision,
  dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_abi_user ON public.ai_brain_insights(user_id, created_at DESC);
ALTER TABLE public.ai_brain_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.ai_brain_insights FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own update" ON public.ai_brain_insights FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "svc all" ON public.ai_brain_insights FOR ALL TO service_role USING (true) WITH CHECK (true);