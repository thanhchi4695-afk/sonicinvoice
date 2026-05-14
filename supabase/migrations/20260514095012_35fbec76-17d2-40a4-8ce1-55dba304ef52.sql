ALTER TABLE public.claude_skills
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_claude_skills_user_active
  ON public.claude_skills(user_id, is_active)
  WHERE is_active = true;