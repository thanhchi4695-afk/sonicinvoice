ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS shopify_connections_needs_reauth_idx
  ON public.shopify_connections (user_id)
  WHERE needs_reauth = true;