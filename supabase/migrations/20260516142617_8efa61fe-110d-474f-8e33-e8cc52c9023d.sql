CREATE OR REPLACE FUNCTION public.ensure_shop_for_current_user()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_shop uuid;
  v_store text;
BEGIN
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already a member? Return first shop.
  SELECT shop_id INTO v_shop
    FROM public.shop_users
   WHERE user_id = v_user
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_shop IS NOT NULL THEN
    RETURN v_shop;
  END IF;

  -- Need a shopify connection to auto-provision
  SELECT store_url INTO v_store
    FROM public.shopify_connections
   WHERE user_id = v_user
   LIMIT 1;
  IF v_store IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.shops (name, created_by)
    VALUES (v_store, v_user)
    RETURNING id INTO v_shop;

  INSERT INTO public.shop_users (shop_id, user_id, role)
    VALUES (v_shop, v_user, 'owner')
    ON CONFLICT (shop_id, user_id) DO NOTHING;

  RETURN v_shop;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_shop_for_current_user() TO authenticated;