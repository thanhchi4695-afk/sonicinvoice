
CREATE TABLE IF NOT EXISTS public.agent_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID,
  action_id UUID,
  event_type TEXT,
  actor TEXT,
  payload JSONB,
  shop_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_run_id ON public.agent_audit(run_id);
ALTER TABLE public.agent_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own audit via run"
ON public.agent_audit FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.agent_runs r WHERE r.id = agent_audit.run_id AND r.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID,
  flow_name TEXT,
  autonomy_level TEXT,
  input_payload JSONB,
  output_payload JSONB,
  diff_summary TEXT,
  status TEXT DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_run_id ON public.agent_actions(run_id);
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own actions via run"
ON public.agent_actions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.agent_runs r WHERE r.id = agent_actions.run_id AND r.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID,
  shop_id TEXT,
  title TEXT,
  description TEXT,
  proposed_actions JSONB,
  estimated_impact JSONB,
  priority TEXT,
  category TEXT,
  status TEXT DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_run_id ON public.agent_approvals(run_id);
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own approvals via run"
ON public.agent_approvals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.agent_runs r WHERE r.id = agent_approvals.run_id AND r.user_id = auth.uid()));
