-- Add layout_fingerprint column to invoice_patterns
ALTER TABLE public.invoice_patterns
ADD COLUMN IF NOT EXISTS layout_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_invoice_patterns_layout_fingerprint
  ON public.invoice_patterns (layout_fingerprint);

-- Cross-client shared fingerprint index (no user_id, anonymised)
CREATE TABLE IF NOT EXISTS public.shared_fingerprint_index (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  layout_fingerprint text NOT NULL UNIQUE,
  format_type text,
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_system text,
  price_logic jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_count integer NOT NULL DEFAULT 1,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_fingerprint_index_fp
  ON public.shared_fingerprint_index (layout_fingerprint);

ALTER TABLE public.shared_fingerprint_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read shared fingerprint index"
  ON public.shared_fingerprint_index
  FOR SELECT
  TO authenticated
  USING (true);
