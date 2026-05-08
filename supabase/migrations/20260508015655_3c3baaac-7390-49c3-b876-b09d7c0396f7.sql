ALTER TABLE public.platform_connections 
  DROP CONSTRAINT IF EXISTS platform_connections_user_platform_unique;

-- Remove duplicates first to allow constraint
DELETE FROM public.platform_connections a
USING public.platform_connections b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.platform = b.platform;

ALTER TABLE public.platform_connections
  ADD CONSTRAINT platform_connections_user_platform_unique
  UNIQUE (user_id, platform);