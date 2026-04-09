-- Purchase Orders table
CREATE TABLE public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  expected_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_cost NUMERIC NOT NULL DEFAULT 0,
  linked_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  match_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own purchase orders"
  ON public.purchase_orders
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Purchase Order Lines table
CREATE TABLE public.purchase_order_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_title TEXT NOT NULL DEFAULT '',
  sku TEXT,
  color TEXT,
  size TEXT,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  expected_cost NUMERIC NOT NULL DEFAULT 0,
  actual_cost NUMERIC,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own purchase order lines"
  ON public.purchase_order_lines
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update timestamp trigger
CREATE TRIGGER update_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();