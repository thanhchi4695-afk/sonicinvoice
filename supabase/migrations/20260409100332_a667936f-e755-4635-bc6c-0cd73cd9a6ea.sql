CREATE TABLE public.joor_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  oauth_token   TEXT NOT NULL,
  token_label   TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced   TIMESTAMPTZ,
  UNIQUE(user_id)
);

ALTER TABLE public.joor_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own JOOR connection"
  ON public.joor_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);