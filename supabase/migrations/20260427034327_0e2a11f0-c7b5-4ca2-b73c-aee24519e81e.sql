
-- Extend purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_email text,
  ADD COLUMN IF NOT EXISTS ship_to_location text,
  ADD COLUMN IF NOT EXISTS po_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS notes_supplier text,
  ADD COLUMN IF NOT EXISTS notes_internal text,
  ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Extend purchase_order_lines
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS variant_title text,
  ADD COLUMN IF NOT EXISTS barcode text;

-- po_receipts
CREATE TABLE IF NOT EXISTS public.po_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  received_by text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  shopify_push_status text NOT NULL DEFAULT 'pending',
  shopify_push_error text,
  pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.po_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own po receipts" ON public.po_receipts;
CREATE POLICY "Own po receipts" ON public.po_receipts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_po_receipts_po_id ON public.po_receipts(po_id);

-- po_settings (one per user)
CREATE TABLE IF NOT EXISTS public.po_settings (
  user_id uuid PRIMARY KEY,
  store_name text,
  store_address text,
  store_abn text,
  logo_url text,
  payment_terms text DEFAULT 'Net 30 days',
  email_subject_template text DEFAULT 'Purchase Order {{po_number}} from {{store_name}}',
  email_body_template text DEFAULT 'Hi {{supplier_name}},

Please find attached our purchase order {{po_number}} with an expected delivery date of {{expected_date}}.

Grand total: {{grand_total}}.

Thank you,
{{store_name}}',
  default_lead_time_days integer NOT NULL DEFAULT 14,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.po_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own po settings" ON public.po_settings;
CREATE POLICY "Own po settings" ON public.po_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_po_settings_updated_at ON public.po_settings;
CREATE TRIGGER update_po_settings_updated_at
  BEFORE UPDATE ON public.po_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-generate po_number per user (PO-0001, PO-0002, ...)
CREATE OR REPLACE FUNCTION public.set_po_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_num int;
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' OR NEW.po_number = 'AUTO' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number, '\D', '', 'g'), '')::int), 0) + 1
      INTO next_num FROM public.purchase_orders WHERE user_id = NEW.user_id;
    NEW.po_number := 'PO-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_po_number ON public.purchase_orders;
CREATE TRIGGER trg_set_po_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_po_number();
