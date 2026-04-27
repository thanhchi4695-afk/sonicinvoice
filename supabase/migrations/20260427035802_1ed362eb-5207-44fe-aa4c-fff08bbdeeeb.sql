-- Extend stocktakes
ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS stocktake_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS scope_vendors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_product_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS count_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS adjustments_applied_at timestamptz;

-- Extend stocktake_lines
ALTER TABLE public.stocktake_lines
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS variant_id text,
  ADD COLUMN IF NOT EXISTS variant_title text,
  ADD COLUMN IF NOT EXISTS vendor text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS shopify_inventory_item_id text,
  ADD COLUMN IF NOT EXISTS is_counted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS push_error text;

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_stocktake ON public.stocktake_lines(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_barcode ON public.stocktake_lines(barcode);

-- Auto-number trigger
CREATE OR REPLACE FUNCTION public.set_stocktake_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
BEGIN
  IF NEW.stocktake_number IS NULL OR NEW.stocktake_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(stocktake_number, '\D', '', 'g'), '')::int), 0) + 1
      INTO next_num FROM public.stocktakes WHERE user_id = NEW.user_id;
    NEW.stocktake_number := 'ST-' || lpad(next_num::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_stocktake_number ON public.stocktakes;
CREATE TRIGGER trg_set_stocktake_number
  BEFORE INSERT ON public.stocktakes
  FOR EACH ROW EXECUTE FUNCTION public.set_stocktake_number();