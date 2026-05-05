
CREATE TABLE public.collection_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  trigger_source text,
  trigger_data jsonb DEFAULT '{}'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions_taken jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  next_run_at timestamptz
);
CREATE INDEX idx_cw_user ON public.collection_workflows(user_id, created_at DESC);
ALTER TABLE public.collection_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cw_select_own" ON public.collection_workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cw_insert_own" ON public.collection_workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cw_update_own" ON public.collection_workflows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cw_delete_own" ON public.collection_workflows FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.collection_approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.collection_workflows(id) ON DELETE SET NULL,
  approval_type text NOT NULL,
  collection_title text,
  collection_handle text,
  rationale text,
  preview_data jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  auto_approve_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_caq_user_status ON public.collection_approval_queue(user_id, status, created_at DESC);
CREATE INDEX idx_caq_auto_approve ON public.collection_approval_queue(auto_approve_at) WHERE status = 'pending';
ALTER TABLE public.collection_approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caq_select_own" ON public.collection_approval_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "caq_insert_own" ON public.collection_approval_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "caq_update_own" ON public.collection_approval_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "caq_delete_own" ON public.collection_approval_queue FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.collection_automation_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_health_check boolean NOT NULL DEFAULT true,
  weekly_digest_email text,
  auto_approve_brand_collections boolean NOT NULL DEFAULT false,
  auto_approve_brand_stories boolean NOT NULL DEFAULT false,
  auto_approve_threshold_hours integer NOT NULL DEFAULT 24,
  seo_auto_generate boolean NOT NULL DEFAULT true,
  auto_archive_empty boolean NOT NULL DEFAULT false,
  seasonal_lifecycle boolean NOT NULL DEFAULT false,
  slack_webhook_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.collection_automation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cas_select_own" ON public.collection_automation_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cas_insert_own" ON public.collection_automation_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cas_update_own" ON public.collection_automation_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cas_delete_own" ON public.collection_automation_settings FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_cas_updated BEFORE UPDATE ON public.collection_automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
