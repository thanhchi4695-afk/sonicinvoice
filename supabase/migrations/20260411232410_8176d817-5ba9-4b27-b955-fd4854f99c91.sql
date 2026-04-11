
-- Competitors table
CREATE TABLE public.competitors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  is_shopify BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own competitors" ON public.competitors FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_competitors_updated_at BEFORE UPDATE ON public.competitors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Monitored products (which of merchant's products to track)
CREATE TABLE public.competitor_monitored_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  product_title TEXT NOT NULL,
  product_vendor TEXT,
  product_type TEXT,
  product_sku TEXT,
  shopify_product_id TEXT,
  retail_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.competitor_monitored_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own monitored products" ON public.competitor_monitored_products FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Competitor prices (cached results)
CREATE TABLE public.competitor_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  monitored_product_id UUID NOT NULL REFERENCES public.competitor_monitored_products(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  matched_title TEXT,
  matched_url TEXT,
  competitor_price NUMERIC,
  confidence_score INTEGER DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  last_checked TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.competitor_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own competitor prices" ON public.competitor_prices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_competitor_prices_updated_at BEFORE UPDATE ON public.competitor_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Price change audit log
CREATE TABLE public.competitor_price_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  monitored_product_id UUID NOT NULL REFERENCES public.competitor_monitored_products(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  old_price NUMERIC NOT NULL,
  new_price NUMERIC NOT NULL,
  competitor_price NUMERIC NOT NULL,
  change_method TEXT NOT NULL DEFAULT 'match',
  change_detail TEXT,
  shopify_updated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.competitor_price_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own price changes" ON public.competitor_price_changes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
