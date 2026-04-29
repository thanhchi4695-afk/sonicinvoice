-- Tokens issued to the Chrome extension. We store ONLY the SHA-256 hash; the
-- raw token is shown to the user once at creation time and never again.
CREATE TABLE public.margin_guardian_extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Chrome extension',
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mg_ext_tokens_user ON public.margin_guardian_extension_tokens(user_id);
CREATE INDEX idx_mg_ext_tokens_hash ON public.margin_guardian_extension_tokens(token_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.margin_guardian_extension_tokens ENABLE ROW LEVEL SECURITY;

-- Users see / create / revoke only their own tokens. token_hash is fine to expose
-- to the owner because they already created it; it's useless without the raw token.
CREATE POLICY "Own extension tokens select"
  ON public.margin_guardian_extension_tokens FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Own extension tokens insert"
  ON public.margin_guardian_extension_tokens FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own extension tokens update"
  ON public.margin_guardian_extension_tokens FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SECURITY DEFINER helper — the edge function (using service role) calls this
-- to resolve a token hash to a user_id without bypassing the table's RLS for clients.
CREATE OR REPLACE FUNCTION public.verify_extension_token(_token_hash TEXT)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM public.margin_guardian_extension_tokens
  WHERE token_hash = _token_hash
    AND revoked_at IS NULL
  LIMIT 1
$$;