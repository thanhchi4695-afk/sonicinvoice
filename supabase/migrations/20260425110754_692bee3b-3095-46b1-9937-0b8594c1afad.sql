ALTER TABLE public.agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_agent_mode_check;
ALTER TABLE public.agent_sessions ADD CONSTRAINT agent_sessions_agent_mode_check
  CHECK (agent_mode = ANY (ARRAY['supervised'::text, 'auto'::text, 'shadow'::text]));