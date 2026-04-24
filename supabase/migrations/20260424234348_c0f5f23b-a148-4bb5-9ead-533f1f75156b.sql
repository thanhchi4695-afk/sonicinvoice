-- Add expiring-token fields to platform_connections (Shopify rows use these; others stay NULL)
ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS platform_connections_shopify_needs_reauth_idx
  ON public.platform_connections (user_id)
  WHERE platform = 'shopify' AND needs_reauth = true;

-- Migration log
CREATE TABLE IF NOT EXISTS public.shopify_token_migration_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  shop_domain TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'auto',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_token_migration_log_user_idx
  ON public.shopify_token_migration_log (user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS shopify_token_migration_log_shop_idx
  ON public.shopify_token_migration_log (shop_domain, attempted_at DESC);

ALTER TABLE public.shopify_token_migration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view migration log"
  ON public.shopify_token_migration_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert migration log"
  ON public.shopify_token_migration_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));