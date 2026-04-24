-- ─────────────────────────────────────────────────────────────
-- Agent layer schema (Part 10.1)
-- ─────────────────────────────────────────────────────────────

-- 1. agent_sessions ─ top-level run
CREATE TABLE public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid,
  delivery_id text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','awaiting_gate','completed','failed','cancelled')),
  current_step text
    CHECK (current_step IN ('capture','extract','stock_check','enrich','price','publish')),
  agent_mode text NOT NULL DEFAULT 'supervised'
    CHECK (agent_mode IN ('supervised','auto')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  total_cost_cents integer NOT NULL DEFAULT 0,
  gate_count integer NOT NULL DEFAULT 0,
  last_narrative text,
  error jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_sessions_user_active
  ON public.agent_sessions(user_id, status)
  WHERE status <> 'completed';

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent sessions" ON public.agent_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. agent_step_runs ─ per-step audit log
CREATE TABLE public.agent_step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL
    CHECK (status IN ('running','done','needs_review','skipped','failed')),
  edge_function text,
  input jsonb,
  output jsonb,
  confidence numeric(3,2),
  narrative text,
  duration_ms integer,
  cost_cents integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX idx_step_runs_session
  ON public.agent_step_runs(session_id, started_at DESC);

ALTER TABLE public.agent_step_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent step runs" ON public.agent_step_runs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. agent_decisions ─ every Claude call logged
CREATE TABLE public.agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_run_id uuid REFERENCES public.agent_step_runs(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  decision_type text NOT NULL
    CHECK (decision_type IN ('proceed','gate','retry','skip','escalate')),
  confidence numeric(3,2),
  reasoning text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  cost_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_decisions_session
  ON public.agent_decisions(session_id, created_at DESC);

ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent decisions" ON public.agent_decisions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. agent_budgets ─ per-user monthly cap
CREATE TABLE public.agent_budgets (
  user_id uuid PRIMARY KEY,
  monthly_cap_cents integer NOT NULL DEFAULT 500,
  month_start date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  spent_cents integer NOT NULL DEFAULT 0,
  degraded boolean NOT NULL DEFAULT false,
  last_reset_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent budget" ON public.agent_budgets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. agent_global_budget ─ single-row global ceiling
CREATE TABLE public.agent_global_budget (
  id integer PRIMARY KEY DEFAULT 1,
  monthly_cap_cents integer NOT NULL DEFAULT 50000,
  spent_cents integer NOT NULL DEFAULT 0,
  month_start date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  CHECK (id = 1)
);

INSERT INTO public.agent_global_budget (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.agent_global_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read global budget" ON public.agent_global_budget
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can update global budget" ON public.agent_global_budget
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 6. agent_feedback ─ user corrections at gates
CREATE TABLE public.agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  step_run_id uuid REFERENCES public.agent_step_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  feedback_type text NOT NULL
    CHECK (feedback_type IN ('accept','edit','reject','override')),
  original_value jsonb,
  corrected_value jsonb,
  supplier text,
  delta_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_supplier
  ON public.agent_feedback(user_id, supplier, created_at DESC);

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent feedback" ON public.agent_feedback
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. agent_calibration_log ─ confidence calibration over time
CREATE TABLE public.agent_calibration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  step text,
  predicted_confidence numeric(3,2),
  user_accepted boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calibration_step_created
  ON public.agent_calibration_log(step, created_at DESC);

ALTER TABLE public.agent_calibration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own calibration entries" ON public.agent_calibration_log
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. brand_rules ─ per-brand rules consumed by the agent
CREATE TABLE public.brand_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  rule_type text NOT NULL
    CHECK (rule_type IN ('url_pattern','colour_normalise','mixed_brand_detect','sku_pattern')),
  rule_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_rules_brand ON public.brand_rules(brand);

ALTER TABLE public.brand_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read brand rules" ON public.brand_rules
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins manage brand rules" ON public.brand_rules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_brand_rules_updated_at
  BEFORE UPDATE ON public.brand_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed brand rules (3 known issues from the fetch audit)
INSERT INTO public.brand_rules (brand, rule_type, rule_data, notes) VALUES
  ('Olga Berg', 'url_pattern',
   '{"domain": "olgaberg.com", "deprecated_domain": "olgaberg.com.au"}'::jsonb,
   'Use olgaberg.com — the .com.au domain is deprecated and returns wrong product pages.'),
  ('Walnut Melbourne', 'colour_normalise',
   '{"strip_suffixes": ["Green","Orange","Blue","Red","Black","White","Cream","Tan","Mosaique"]}'::jsonb,
   'Walnut titles often include trailing colour words. Strip them before fuzzy title matching.'),
  ('Skye Group', 'mixed_brand_detect',
   '{"sub_brands": ["Skye","Skye Swimwear","Skye Botanica"], "require_explicit_brand": true}'::jsonb,
   'Skye Group invoices mix multiple sub-brands. Require explicit brand attribution per line item.');

-- ─────────────────────────────────────────────────────────────
-- Realtime — sessions and step runs only
-- (decisions/feedback/calibration are too high-volume or low-priority)
-- ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_step_runs;

ALTER TABLE public.agent_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.agent_step_runs REPLICA IDENTITY FULL;