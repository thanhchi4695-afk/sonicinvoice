-- Add website RRP source configuration to supplier_profiles.
-- Lets retailers point Sonic at a supplier's public website (typically a
-- Shopify storefront with /products/{handle}.json) so RRPs come from the
-- brand itself rather than a markup formula.

ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS website_pricing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_scraper_type text NOT NULL DEFAULT 'shopify',
  ADD COLUMN IF NOT EXISTS website_last_scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS website_products_cached integer NOT NULL DEFAULT 0;

-- Cache of scraped supplier website prices, keyed by supplier + style/handle.
-- Lets us answer RRP lookups without a network call on every invoice line.
CREATE TABLE IF NOT EXISTS public.supplier_website_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  supplier_profile_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  handle text,
  product_title text,
  colour text,
  size text,
  price numeric NOT NULL,
  compare_at_price numeric,
  currency text NOT NULL DEFAULT 'AUD',
  product_url text,
  scraped_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swp_user_supplier
  ON public.supplier_website_prices(user_id, supplier_profile_id);
CREATE INDEX IF NOT EXISTS idx_swp_handle
  ON public.supplier_website_prices(supplier_profile_id, handle);
CREATE INDEX IF NOT EXISTS idx_swp_title
  ON public.supplier_website_prices(supplier_profile_id, lower(product_title));

ALTER TABLE public.supplier_website_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own supplier website prices"
  ON public.supplier_website_prices
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);