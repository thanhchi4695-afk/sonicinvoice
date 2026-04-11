
-- Stocktakes table
CREATE TABLE public.stocktakes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  location TEXT NOT NULL DEFAULT 'Main Store',
  counted_at DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own stocktakes" ON public.stocktakes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_stocktakes_updated_at
  BEFORE UPDATE ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Stocktake lines
CREATE TABLE public.stocktake_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  sku TEXT,
  barcode TEXT,
  product_title TEXT,
  counted_qty INTEGER NOT NULL DEFAULT 0,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  variance INTEGER GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  shopify_variant_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stocktake_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own stocktake lines" ON public.stocktake_lines FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Inventory adjustments
CREATE TABLE public.inventory_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sku TEXT,
  barcode TEXT,
  product_title TEXT,
  adjustment_qty INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  adjusted_at DATE NOT NULL DEFAULT CURRENT_DATE,
  location TEXT NOT NULL DEFAULT 'Main Store',
  shopify_variant_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own inventory adjustments" ON public.inventory_adjustments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
