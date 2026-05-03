CREATE TABLE IF NOT EXISTS public.claude_skill_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  skill_name text NOT NULL,
  feature text NOT NULL,
  task_type text,
  supplier_name text,
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csu_user_skill ON public.claude_skill_usage(user_id, skill_name, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_csu_user_used_at ON public.claude_skill_usage(user_id, used_at DESC);

ALTER TABLE public.claude_skill_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own skill usage"
  ON public.claude_skill_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role inserts skill usage"
  ON public.claude_skill_usage FOR INSERT
  WITH CHECK (true);
