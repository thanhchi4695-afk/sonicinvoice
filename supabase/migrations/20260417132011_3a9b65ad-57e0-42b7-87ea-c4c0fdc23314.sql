ALTER TABLE public.invoice_patterns
ADD COLUMN IF NOT EXISTS match_method text;

CREATE INDEX IF NOT EXISTS idx_invoice_patterns_match_method
  ON public.invoice_patterns (match_method);
