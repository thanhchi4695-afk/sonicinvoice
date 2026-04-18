ALTER TABLE public.correction_log
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS invoice_id text;

CREATE INDEX IF NOT EXISTS idx_correction_log_supplier_name
  ON public.correction_log (user_id, supplier_name);

CREATE INDEX IF NOT EXISTS idx_correction_log_invoice_id
  ON public.correction_log (user_id, invoice_id);