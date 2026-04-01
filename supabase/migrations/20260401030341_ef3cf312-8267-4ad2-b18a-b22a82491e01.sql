
-- Table for storing Shopify connection credentials per user
CREATE TABLE public.shopify_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  store_url TEXT NOT NULL,
  access_token TEXT NOT NULL,
  api_version TEXT NOT NULL DEFAULT '2024-10',
  default_location_id TEXT,
  product_status TEXT NOT NULL DEFAULT 'draft',
  shop_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.shopify_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own Shopify connection"
  ON public.shopify_connections
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table for push history
CREATE TABLE public.shopify_push_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  store_url TEXT NOT NULL,
  products_created INTEGER NOT NULL DEFAULT 0,
  products_updated INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_push_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push history"
  ON public.shopify_push_history
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
