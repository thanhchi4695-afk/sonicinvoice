CREATE TABLE public.sales_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  variant_id UUID REFERENCES public.variants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_sold INTEGER NOT NULL DEFAULT 1,
  revenue NUMERIC NOT NULL DEFAULT 0,
  cost_of_goods NUMERIC NOT NULL DEFAULT 0,
  sold_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual',
  order_ref TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own sales data"
  ON public.sales_data
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sales_data_variant ON public.sales_data(variant_id);
CREATE INDEX idx_sales_data_product ON public.sales_data(product_id);
CREATE INDEX idx_sales_data_sold_at ON public.sales_data(sold_at);