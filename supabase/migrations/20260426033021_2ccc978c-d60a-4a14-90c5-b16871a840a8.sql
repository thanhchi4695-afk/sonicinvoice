-- Clear bogus expiry / refresh metadata from Custom App (shpat_) tokens.
-- Custom App tokens never expire and have no refresh endpoint; any values on
-- these columns were written in error by an earlier token-exchange attempt and
-- would otherwise cause the app to schedule pointless refresh calls and
-- eventually mark the connection needs_reauth.

UPDATE public.shopify_connections
SET token_expires_at = NULL,
    refresh_token = NULL,
    refresh_token_expires_at = NULL,
    needs_reauth = false
WHERE access_token LIKE 'shpat_%';

UPDATE public.platform_connections
SET token_expires_at = NULL,
    refresh_token = NULL,
    refresh_token_expires_at = NULL,
    needs_reauth = false
WHERE platform = 'shopify'
  AND access_token LIKE 'shpat_%';