CREATE TABLE public.product_reorder_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  variant_id UUID REFERENCES public.variants(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  lead_time_days INTEGER NOT NULL DEFAULT 14,
  safety_stock_days INTEGER NOT NULL DEFAULT 7,
  desired_cover_days INTEGER NOT NULL DEFAULT 30,
  min_order_qty INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, variant_id)
);

ALTER TABLE public.product_reorder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own reorder settings"
  ON public.product_reorder_settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_product_reorder_settings_updated_at
  BEFORE UPDATE ON public.product_reorder_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();