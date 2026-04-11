-- Transfer Orders
CREATE TABLE public.transfer_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  from_location TEXT NOT NULL,
  from_location_id TEXT,
  to_location TEXT NOT NULL,
  to_location_id TEXT,
  expected_ship_date DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.transfer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own transfer orders"
  ON public.transfer_orders FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_transfer_orders_updated_at
  BEFORE UPDATE ON public.transfer_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Transfer Order Lines
CREATE TABLE public.transfer_order_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  transfer_order_id UUID NOT NULL REFERENCES public.transfer_orders(id) ON DELETE CASCADE,
  sku TEXT,
  barcode TEXT,
  product_title TEXT,
  shopify_variant_id TEXT,
  shopify_inventory_item_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  shipped_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.transfer_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own transfer order lines"
  ON public.transfer_order_lines FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);