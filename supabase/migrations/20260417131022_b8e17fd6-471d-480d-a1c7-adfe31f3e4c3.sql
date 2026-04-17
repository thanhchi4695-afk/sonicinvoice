ALTER TABLE public.invoice_patterns
  ADD COLUMN IF NOT EXISTS field_confidence_history jsonb NOT NULL DEFAULT '[]'::jsonb;