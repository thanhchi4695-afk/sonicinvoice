
CREATE TABLE public.shopify_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  api_key text NOT NULL,
  api_secret text NOT NULL,
  shop_domain text,
  scopes text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX shopify_apps_api_key_unique
  ON public.shopify_apps (api_key);

CREATE UNIQUE INDEX shopify_apps_shop_active_unique
  ON public.shopify_apps (shop_domain)
  WHERE shop_domain IS NOT NULL AND is_active = true;

ALTER TABLE public.shopify_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view shopify apps"
  ON public.shopify_apps FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert shopify apps"
  ON public.shopify_apps FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update shopify apps"
  ON public.shopify_apps FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete shopify apps"
  ON public.shopify_apps FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_shopify_apps_updated_at
  BEFORE UPDATE ON public.shopify_apps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
