-- ── Persist real processing duration + per-edit audit trail ─────────
-- Existing columns review_duration_seconds / processing_quality_score / edit_count
-- already exist on invoice_patterns. We add two more to capture the
-- actual server-side processing time independently of human review time,
-- and an audit table for per-field edits (Bug #13).

ALTER TABLE public.invoice_patterns
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS rows_seen integer,
  ADD COLUMN IF NOT EXISTS variants_extracted integer;

-- Per-field edit audit log (Bug #13). Each row = one field corrected
-- on the Review screen. Powers the Edits column in Processing History
-- and feeds Brain learning signals.
CREATE TABLE IF NOT EXISTS public.invoice_line_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_pattern_id uuid REFERENCES public.invoice_patterns(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  row_index integer,
  edited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_edits_pattern
  ON public.invoice_line_edits(invoice_pattern_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_edits_user
  ON public.invoice_line_edits(user_id, edited_at DESC);

ALTER TABLE public.invoice_line_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own line edits"
  ON public.invoice_line_edits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own line edits"
  ON public.invoice_line_edits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own line edits"
  ON public.invoice_line_edits FOR DELETE
  USING (auth.uid() = user_id);