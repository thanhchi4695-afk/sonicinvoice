CREATE TABLE public.wholesale_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  platform     TEXT NOT NULL,
  label        TEXT,
  credentials  JSONB NOT NULL DEFAULT '{}',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced  TIMESTAMPTZ,
  UNIQUE(user_id, platform)
);

ALTER TABLE public.wholesale_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wholesale connections"
  ON public.wholesale_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);