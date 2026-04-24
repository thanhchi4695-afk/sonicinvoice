-- Backfill platform_connections from existing shopify_connections rows
-- so already-connected Shopify stores show up correctly in the dashboard
-- and are usable by the catalog sync function.
INSERT INTO public.platform_connections (user_id, platform, shop_domain, access_token, is_active)
SELECT sc.user_id, 'shopify', sc.store_url, sc.access_token, true
FROM public.shopify_connections sc
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_connections pc
  WHERE pc.user_id = sc.user_id AND pc.platform = 'shopify'
);