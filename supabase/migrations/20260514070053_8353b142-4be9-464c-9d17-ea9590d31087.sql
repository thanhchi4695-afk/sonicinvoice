CREATE TABLE public.sonic_mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Claude connector',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sonic_mcp_tokens_user ON public.sonic_mcp_tokens(user_id);
CREATE INDEX idx_sonic_mcp_tokens_hash ON public.sonic_mcp_tokens(token_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.sonic_mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own mcp tokens select" ON public.sonic_mcp_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own mcp tokens insert" ON public.sonic_mcp_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own mcp tokens update" ON public.sonic_mcp_tokens
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own mcp tokens delete" ON public.sonic_mcp_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.verify_sonic_mcp_token(_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM public.sonic_mcp_tokens
  WHERE token_hash = _token_hash
    AND revoked_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.touch_sonic_mcp_token(_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sonic_mcp_tokens
     SET last_used_at = now()
   WHERE token_hash = _token_hash
     AND revoked_at IS NULL;
$$;