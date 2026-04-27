-- Sequence for adjustment numbers per user
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  adjustment_number text NOT NULL,
  location text NOT NULL,
  reason text NOT NULL,
  notes text,
  adjusted_by text,
  adjustment_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'open',
  applied_at timestamptz,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_user ON public.stock_adjustments(user_id, created_at DESC);

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own stock adjustments"
  ON public.stock_adjustments
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_stock_adjustments_updated_at
  BEFORE UPDATE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-generate adjustment_number per user (ADJ-001, ADJ-002, ...)
CREATE OR REPLACE FUNCTION public.set_stock_adjustment_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
BEGIN
  IF NEW.adjustment_number IS NULL OR NEW.adjustment_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(adjustment_number, '\D', '', 'g'), '')::int), 0) + 1
      INTO next_num
      FROM public.stock_adjustments
      WHERE user_id = NEW.user_id;
    NEW.adjustment_number := 'ADJ-' || lpad(next_num::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_adjustments_set_number
  BEFORE INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_stock_adjustment_number();