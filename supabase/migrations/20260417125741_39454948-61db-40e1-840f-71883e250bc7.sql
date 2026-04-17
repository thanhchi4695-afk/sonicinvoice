-- Extend correction_log with richer tracking fields
ALTER TABLE public.correction_log
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS correction_reason_detail text,
  ADD COLUMN IF NOT EXISTS field_category text,
  ADD COLUMN IF NOT EXISTS auto_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_invoice_index integer;

-- Validate correction_reason values
ALTER TABLE public.correction_log
  DROP CONSTRAINT IF EXISTS correction_log_correction_reason_check;
ALTER TABLE public.correction_log
  ADD CONSTRAINT correction_log_correction_reason_check
  CHECK (
    correction_reason IS NULL OR correction_reason IN (
      'wrong_column_detected',
      'wrong_format',
      'currency_error',
      'size_system_wrong',
      'missed_field',
      'wrong_value',
      'other'
    )
  );

-- Validate field_category values
ALTER TABLE public.correction_log
  DROP CONSTRAINT IF EXISTS correction_log_field_category_check;
ALTER TABLE public.correction_log
  ADD CONSTRAINT correction_log_field_category_check
  CHECK (
    field_category IS NULL OR field_category IN (
      'identification',
      'pricing',
      'variant',
      'metadata'
    )
  );

-- Ensure RLS is enabled
ALTER TABLE public.correction_log ENABLE ROW LEVEL SECURITY;

-- Replace the catch-all policy with explicit per-command policies
DROP POLICY IF EXISTS "Own correction log" ON public.correction_log;
DROP POLICY IF EXISTS "Users can read own correction log" ON public.correction_log;
DROP POLICY IF EXISTS "Users can insert own correction log" ON public.correction_log;
DROP POLICY IF EXISTS "Users can update own correction log" ON public.correction_log;
DROP POLICY IF EXISTS "Users can delete own correction log" ON public.correction_log;

CREATE POLICY "Users can read own correction log"
  ON public.correction_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own correction log"
  ON public.correction_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own correction log"
  ON public.correction_log
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own correction log"
  ON public.correction_log
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);