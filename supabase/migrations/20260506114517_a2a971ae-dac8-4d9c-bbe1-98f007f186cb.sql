CREATE TABLE public.agent_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type         TEXT NOT NULL,
  trigger_source    TEXT NOT NULL,
  trigger_context   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'suggested',
  observation       TEXT,
  proposed_action   TEXT,
  permission_question TEXT,
  result_summary    TEXT,
  result_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_task_id    UUID REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  pipeline_id       TEXT,
  pipeline_step     INT,
  next_task_type    TEXT,
  next_pipeline     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  dismissed_at      TIMESTAMPTZ,
  due_at            TIMESTAMPTZ
);

CREATE INDEX idx_agent_tasks_user_status
  ON public.agent_tasks(user_id, status, created_at DESC);

CREATE INDEX idx_agent_tasks_parent
  ON public.agent_tasks(parent_task_id);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_agent_tasks"
  ON public.agent_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_agent_tasks"
  ON public.agent_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_agent_tasks"
  ON public.agent_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_agent_tasks"
  ON public.agent_tasks FOR DELETE
  USING (auth.uid() = user_id);