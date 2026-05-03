CREATE TABLE IF NOT EXISTS public.claude_skills (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  skill_name text NOT NULL,
  content text NOT NULL DEFAULT '',
  task_types text[] NOT NULL DEFAULT '{}',
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_name)
);

ALTER TABLE public.claude_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own skills"
  ON public.claude_skills FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own skills"
  ON public.claude_skills FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own skills"
  ON public.claude_skills FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own skills"
  ON public.claude_skills FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_claude_skills_user_name
  ON public.claude_skills (user_id, skill_name);

CREATE TRIGGER trg_claude_skills_updated_at
BEFORE UPDATE ON public.claude_skills
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();