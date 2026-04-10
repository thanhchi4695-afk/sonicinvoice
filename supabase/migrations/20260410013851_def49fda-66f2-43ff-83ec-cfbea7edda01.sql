CREATE TABLE public.pos_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  platform         TEXT NOT NULL,

  -- SHOPIFY
  shopify_domain         TEXT,
  shopify_access_token   TEXT,
  shopify_connected      BOOLEAN DEFAULT false,

  -- LIGHTSPEED X-SERIES (Vend)
  ls_x_domain_prefix    TEXT,
  ls_x_access_token     TEXT,
  ls_x_refresh_token    TEXT,
  ls_x_token_expires_at TIMESTAMPTZ,

  -- LIGHTSPEED R-SERIES
  ls_r_account_id       TEXT,
  ls_r_access_token     TEXT,
  ls_r_refresh_token    TEXT,
  ls_r_token_expires_at TIMESTAMPTZ,

  -- SHARED
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced      TIMESTAMPTZ,
  UNIQUE(user_id, platform)
);

ALTER TABLE public.pos_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own POS connections"
  ON public.pos_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);