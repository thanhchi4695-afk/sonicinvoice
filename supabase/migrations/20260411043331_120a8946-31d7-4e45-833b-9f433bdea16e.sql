
CREATE TABLE public.price_lookups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  supplier TEXT NOT NULL,
  product_name TEXT NOT NULL,
  style_number TEXT,
  colour TEXT,
  supplier_cost NUMERIC,
  retail_price_aud NUMERIC,
  price_confidence INTEGER DEFAULT 0,
  image_urls JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  source_url TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.price_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own price lookups"
  ON public.price_lookups
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_price_lookups_updated_at
  BEFORE UPDATE ON public.price_lookups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
