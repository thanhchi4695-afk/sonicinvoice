
-- 1. Experiments
CREATE TABLE public.discount_strategy_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id text NOT NULL UNIQUE,
  strategy_name text NOT NULL,
  parameters jsonb NOT NULL,
  efficiency_score double precision,
  velocity_gain_pct double precision,
  margin_loss_pct double precision,
  sample_size integer DEFAULT 0,
  test_started_at timestamptz,
  test_completed_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  blacklisted boolean NOT NULL DEFAULT false,
  pending_human_approval boolean NOT NULL DEFAULT false,
  parent_variant_id text,
  promoted_at timestamptz,
  notes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dse_active ON public.discount_strategy_experiments (is_active) WHERE is_active = true;
CREATE INDEX idx_dse_started ON public.discount_strategy_experiments (test_started_at DESC);

-- 2. Feedback (actual sales)
CREATE TABLE public.discount_strategy_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid REFERENCES public.discount_strategy_experiments(id) ON DELETE CASCADE,
  variant_id text NOT NULL,
  product_id text NOT NULL,
  units_sold_during_test integer DEFAULT 0,
  revenue_during_test numeric(12,2) DEFAULT 0,
  margin_during_test numeric(12,2) DEFAULT 0,
  discount_applied_pct integer DEFAULT 0,
  competitor_price_at_test numeric(12,2),
  baseline_velocity double precision,
  observation_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, product_id, observation_date)
);
CREATE INDEX idx_dsf_variant ON public.discount_strategy_feedback (variant_id, observation_date DESC);

-- 3. Run log
CREATE TABLE public.discount_strategy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  run_started_at timestamptz NOT NULL DEFAULT now(),
  run_completed_at timestamptz,
  experiments_ran integer DEFAULT 0,
  winning_variant_id text,
  previous_variant_id text,
  efficiency_improvement_pct double precision,
  promoted boolean DEFAULT false,
  notes jsonb,
  error_message text
);
CREATE INDEX idx_dsl_started ON public.discount_strategy_log (run_started_at DESC);

-- 4. Weekly test product set
CREATE TABLE public.test_product_set_discount (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  product_title text,
  current_price numeric(12,2),
  cost_price numeric(12,2),
  inventory_quantity integer,
  weekly_velocity_baseline double precision,
  test_week_start date NOT NULL,
  test_week_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, test_week_start)
);
CREATE INDEX idx_tpsd_week ON public.test_product_set_discount (test_week_start DESC);

-- 5. Per-product variant assignments for the week
CREATE TABLE public.discount_variant_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_week_start date NOT NULL,
  product_id text NOT NULL,
  variant_id text NOT NULL,
  experiment_id uuid REFERENCES public.discount_strategy_experiments(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_week_start, product_id)
);
CREATE INDEX idx_dva_lookup ON public.discount_variant_assignments (product_id, test_week_start DESC);
CREATE INDEX idx_dva_variant ON public.discount_variant_assignments (variant_id);

-- 6. Per-user settings
CREATE TABLE public.discount_optimizer_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  auto_promote boolean NOT NULL DEFAULT false,
  schedule_cron text DEFAULT '0 2 * * 0',
  max_margin_loss_pct numeric(5,2) NOT NULL DEFAULT 15.00,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.discount_strategy_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_strategy_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_strategy_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_product_set_discount ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_variant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_optimizer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read dse" ON public.discount_strategy_experiments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write dse" ON public.discount_strategy_experiments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "auth read dsf" ON public.discount_strategy_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write dsf" ON public.discount_strategy_feedback FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "auth read dsl" ON public.discount_strategy_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write dsl" ON public.discount_strategy_log FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "auth read tpsd" ON public.test_product_set_discount FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write tpsd" ON public.test_product_set_discount FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "auth read dva" ON public.discount_variant_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write dva" ON public.discount_variant_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "own settings read" ON public.discount_optimizer_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own settings write" ON public.discount_optimizer_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at trigger
CREATE TRIGGER trg_dse_updated_at BEFORE UPDATE ON public.discount_strategy_experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dos_updated_at BEFORE UPDATE ON public.discount_optimizer_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed v0 baseline matching current lifecycleEngine constants
INSERT INTO public.discount_strategy_experiments (
  variant_id, strategy_name, parameters, is_active, promoted_at, sample_size, notes
) VALUES (
  'v0',
  'Baseline',
  jsonb_build_object(
    'phaseBands', jsonb_build_object(
      '1', jsonb_build_array(0.0, 0.0),
      '2', jsonb_build_array(0.05, 0.10),
      '3', jsonb_build_array(0.0, 0.05),
      '4', jsonb_build_array(0.30, 0.60),
      '5', jsonb_build_array(0.70, 0.85)
    ),
    'phaseDays', jsonb_build_object('launch', 14, 'firstMark', 30, 'performance', 45, 'clearance', 60),
    'weights', jsonb_build_object('lifecycle', 0.40, 'competitor', 0.30, 'velocity', 0.20, 'margin', 0.10),
    'competitorCapGap', 0.30,
    'velocityWeeksOfCover', jsonb_build_object('low', 4, 'high', 16)
  ),
  true,
  now(),
  0,
  jsonb_build_object('seeded', true, 'source', 'lifecycleEngine defaults')
);
