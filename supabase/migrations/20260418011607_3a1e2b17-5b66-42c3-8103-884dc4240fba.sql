
-- 1. platform_connections
CREATE TABLE public.platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('shopify', 'lightspeed')),
  shop_domain text,
  access_token text,
  location_id text,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own platform connections"
  ON public.platform_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_platform_connections_user ON public.platform_connections(user_id, platform);

-- 2. product_catalog_cache
CREATE TABLE public.product_catalog_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_product_id text NOT NULL,
  platform_variant_id text,
  sku text,
  product_title text,
  variant_title text,
  colour text,
  size text,
  current_qty integer,
  current_cost numeric,
  current_price numeric,
  barcode text,
  cached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, platform_variant_id)
);

ALTER TABLE public.product_catalog_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own product catalog cache"
  ON public.product_catalog_cache FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pcc_user_sku ON public.product_catalog_cache(user_id, sku);
CREATE INDEX idx_pcc_user_barcode ON public.product_catalog_cache(user_id, barcode);
CREATE INDEX idx_pcc_user_title ON public.product_catalog_cache(user_id, product_title);

-- 3. reconciliation_sessions
CREATE TABLE public.reconciliation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id text,
  supplier_name text,
  platform text,
  total_lines integer,
  new_products integer NOT NULL DEFAULT 0,
  exact_refills integer NOT NULL DEFAULT 0,
  new_variants integer NOT NULL DEFAULT 0,
  conflicts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own reconciliation sessions"
  ON public.reconciliation_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_recon_sessions_user ON public.reconciliation_sessions(user_id, created_at DESC);

-- 4. reconciliation_lines
CREATE TABLE public.reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.reconciliation_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_sku text,
  invoice_product_name text,
  invoice_colour text,
  invoice_size text,
  invoice_qty integer,
  invoice_cost numeric,
  invoice_rrp numeric,
  match_type text CHECK (match_type IN ('new', 'exact_refill', 'new_variant', 'new_colour', 'conflict')),
  matched_product_id text,
  matched_variant_id text,
  matched_current_qty integer,
  matched_current_cost numeric,
  cost_delta_pct numeric,
  conflict_reason text,
  user_decision text DEFAULT 'pending' CHECK (user_decision IN ('approved', 'skipped', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own reconciliation lines"
  ON public.reconciliation_lines FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_recon_lines_session ON public.reconciliation_lines(session_id);
