CREATE TABLE public.multi_brand_suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_company_name text NOT NULL,
  brand_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, invoice_company_name)
);

ALTER TABLE public.multi_brand_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own multi-brand rules"
  ON public.multi_brand_suppliers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own multi-brand rules"
  ON public.multi_brand_suppliers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own multi-brand rules"
  ON public.multi_brand_suppliers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own multi-brand rules"
  ON public.multi_brand_suppliers FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_multi_brand_user_company
  ON public.multi_brand_suppliers (user_id, lower(invoice_company_name));

CREATE TRIGGER trg_multi_brand_suppliers_updated_at
  BEFORE UPDATE ON public.multi_brand_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();