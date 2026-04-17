ALTER TABLE public.invoice_patterns
  ADD COLUMN IF NOT EXISTS review_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS edit_count integer,
  ADD COLUMN IF NOT EXISTS rows_deleted integer,
  ADD COLUMN IF NOT EXISTS rows_added integer,
  ADD COLUMN IF NOT EXISTS processing_quality_score integer,
  ADD COLUMN IF NOT EXISTS fields_corrected text[],
  ADD COLUMN IF NOT EXISTS exported_at timestamptz;