
-- =========================================
-- TENANCY: shops + shop_users
-- =========================================
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Australia/Darwin',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.shop_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE IF NOT EXISTS public.shop_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.shop_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_users_user ON public.shop_users(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_users_shop ON public.shop_users(shop_id);

-- Security-definer helper to avoid recursive RLS
CREATE OR REPLACE FUNCTION public.is_shop_member(_shop_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_users
    WHERE shop_id = _shop_id AND user_id = auth.uid()
  );
$$;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view their shops"
  ON public.shops FOR SELECT
  USING (public.is_shop_member(id));
CREATE POLICY "Authenticated users create shops"
  ON public.shops FOR INSERT
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Owners update their shops"
  ON public.shops FOR UPDATE
  USING (public.is_shop_member(id));

CREATE POLICY "Members view shop_users for their shops"
  ON public.shop_users FOR SELECT
  USING (public.is_shop_member(shop_id) OR user_id = auth.uid());
CREATE POLICY "Owners manage shop_users"
  ON public.shop_users FOR ALL
  USING (public.is_shop_member(shop_id))
  WITH CHECK (public.is_shop_member(shop_id));

-- =========================================
-- SONIC AGENT TABLES
-- =========================================

CREATE TABLE public.sonic_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'invoice_received','cron_daily_briefing','cron_slow_stock',
    'cron_reorder','cron_ad_check','user_chat','webhook'
  )),
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN (
    'planning','executing','awaiting_approval','completed','failed','cancelled'
  )),
  planner_model text,
  executor_model text,
  plan_summary text,
  dry_run boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);
CREATE INDEX idx_sonic_agent_runs_shop_status ON public.sonic_agent_runs(shop_id, status, started_at DESC);

CREATE TABLE public.sonic_approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.sonic_agent_runs(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('money_out','live_ads','live_catalog','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text
);
CREATE INDEX idx_sonic_approval_queue_shop ON public.sonic_approval_queue(shop_id, status, priority, created_at DESC);

CREATE TABLE public.sonic_agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.sonic_agent_runs(id) ON DELETE CASCADE,
  flow_name text NOT NULL,
  autonomy_level text NOT NULL CHECK (autonomy_level IN ('autonomous','approval_gated','never_agentic')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','executing','awaiting_approval','approved','rejected','completed','failed','rolled_back'
  )),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb,
  diff_summary text,
  approval_queue_id uuid REFERENCES public.sonic_approval_queue(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  rolled_back_at timestamptz,
  rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_sonic_agent_actions_run ON public.sonic_agent_actions(run_id, status);

CREATE TABLE public.sonic_scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  cron_expression text NOT NULL,
  timezone text NOT NULL DEFAULT 'Australia/Darwin',
  enabled boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL,
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sonic_scheduled_tasks ON public.sonic_scheduled_tasks(shop_id, enabled, next_run_at);

CREATE TABLE public.sonic_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.sonic_agent_runs(id) ON DELETE SET NULL,
  action_id uuid REFERENCES public.sonic_agent_actions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sonic_audit_log_shop ON public.sonic_audit_log(shop_id, created_at DESC);
CREATE INDEX idx_sonic_audit_log_action ON public.sonic_audit_log(action_id);

-- =========================================
-- RLS for sonic_* tables
-- =========================================
ALTER TABLE public.sonic_agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sonic_agent_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sonic_approval_queue   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sonic_scheduled_tasks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sonic_audit_log        ENABLE ROW LEVEL SECURITY;

-- agent_runs
CREATE POLICY "Members read runs"   ON public.sonic_agent_runs FOR SELECT USING (public.is_shop_member(shop_id));
CREATE POLICY "Members insert runs" ON public.sonic_agent_runs FOR INSERT WITH CHECK (public.is_shop_member(shop_id));
CREATE POLICY "Members update runs" ON public.sonic_agent_runs FOR UPDATE USING (public.is_shop_member(shop_id));

-- agent_actions (joined via run)
CREATE POLICY "Members read actions" ON public.sonic_agent_actions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sonic_agent_runs r WHERE r.id = run_id AND public.is_shop_member(r.shop_id)));
CREATE POLICY "Members update actions" ON public.sonic_agent_actions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sonic_agent_runs r WHERE r.id = run_id AND public.is_shop_member(r.shop_id)));

-- approval_queue (users approve/reject)
CREATE POLICY "Members read approvals"   ON public.sonic_approval_queue FOR SELECT USING (public.is_shop_member(shop_id));
CREATE POLICY "Members update approvals" ON public.sonic_approval_queue FOR UPDATE USING (public.is_shop_member(shop_id));

-- scheduled_tasks (users configure)
CREATE POLICY "Members read tasks"   ON public.sonic_scheduled_tasks FOR SELECT USING (public.is_shop_member(shop_id));
CREATE POLICY "Members insert tasks" ON public.sonic_scheduled_tasks FOR INSERT WITH CHECK (public.is_shop_member(shop_id));
CREATE POLICY "Members update tasks" ON public.sonic_scheduled_tasks FOR UPDATE USING (public.is_shop_member(shop_id));
CREATE POLICY "Members delete tasks" ON public.sonic_scheduled_tasks FOR DELETE USING (public.is_shop_member(shop_id));

-- audit_log (read-only for users; writes via service role)
CREATE POLICY "Members read audit"   ON public.sonic_audit_log FOR SELECT USING (public.is_shop_member(shop_id));

-- updated_at trigger for shops
CREATE TRIGGER trg_shops_touch BEFORE UPDATE ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
