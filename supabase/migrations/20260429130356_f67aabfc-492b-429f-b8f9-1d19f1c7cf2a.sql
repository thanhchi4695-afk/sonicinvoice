-- Step 1: Margin Guardian backbone tables (Appendix C.2)

CREATE TABLE public.margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority   INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.margin_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own margin rules"
  ON public.margin_rules
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_margin_rules_user_priority
  ON public.margin_rules (user_id, priority ASC, created_at ASC);

CREATE TRIGGER update_margin_rules_updated_at
  BEFORE UPDATE ON public.margin_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Append-only decision log. Named margin_agent_decisions to avoid collision
-- with the existing public.agent_decisions (LLM step log).
CREATE TABLE public.margin_agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id UUID NULL REFERENCES public.margin_rules(id) ON DELETE SET NULL,
  cart_snapshot JSONB NOT NULL,
  decision_outcome TEXT NOT NULL CHECK (decision_outcome IN ('allowed','blocked','pending_approval','approved','denied','expired')),
  action_taken JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_token TEXT NULL,
  approval_expires_at TIMESTAMPTZ NULL,
  parent_decision_id UUID NULL REFERENCES public.margin_agent_decisions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.margin_agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own margin agent decisions"
  ON public.margin_agent_decisions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_margin_decisions_user_created
  ON public.margin_agent_decisions (user_id, created_at DESC);

CREATE INDEX idx_margin_decisions_parent
  ON public.margin_agent_decisions (parent_decision_id);

CREATE UNIQUE INDEX idx_margin_decisions_token
  ON public.margin_agent_decisions (approval_token)
  WHERE approval_token IS NOT NULL;