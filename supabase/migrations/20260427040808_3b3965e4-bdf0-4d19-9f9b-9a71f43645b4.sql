-- Cache of Shopify locations per user, populated when the user opens the inventory or reports.
CREATE TABLE IF NOT EXISTS public.shopify_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shop_domain text,
  location_id text NOT NULL,
  location_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, location_id)
);

ALTER TABLE public.shopify_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own shopify locations"
  ON public.shopify_locations
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_shopify_locations_user ON public.shopify_locations(user_id);

CREATE TRIGGER trg_shopify_locations_updated_at
  BEFORE UPDATE ON public.shopify_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();