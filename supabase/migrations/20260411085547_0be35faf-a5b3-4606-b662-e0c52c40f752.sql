CREATE TABLE public.supplier_catalog_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT,
  barcode TEXT,
  color TEXT,
  size TEXT,
  cost NUMERIC NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 14,
  min_order_qty INTEGER NOT NULL DEFAULT 1,
  shopify_variant_id TEXT,
  notes TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own supplier catalog items"
  ON public.supplier_catalog_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_supplier_catalog_supplier ON public.supplier_catalog_items(supplier_id);
CREATE INDEX idx_supplier_catalog_sku ON public.supplier_catalog_items(sku);
