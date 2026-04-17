-- Shared (anonymised) invoice patterns aggregated across opted-in users
CREATE TABLE public.shared_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  format_type TEXT,
  column_roles JSONB NOT NULL DEFAULT '{}'::jsonb,
  header_fingerprint TEXT,
  size_system TEXT,
  gst_included_in_cost BOOLEAN,
  gst_included_in_rrp BOOLEAN,
  markup_min NUMERIC,
  markup_max NUMERIC,
  markup_avg NUMERIC,
  pack_notation_detected BOOLEAN DEFAULT false,
  size_matrix_detected BOOLEAN DEFAULT false,
  contributor_count INTEGER NOT NULL DEFAULT 1,
  total_invoices INTEGER NOT NULL DEFAULT 0,
  avg_confidence NUMERIC,
  last_aggregated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shared_patterns_fingerprint ON public.shared_patterns(header_fingerprint);
CREATE INDEX idx_shared_patterns_format ON public.shared_patterns(format_type);

ALTER TABLE public.shared_patterns ENABLE ROW LEVEL SECURITY;

-- All authenticated users can READ shared patterns (it's anonymised pooled knowledge)
CREATE POLICY "Authenticated users can read shared patterns"
  ON public.shared_patterns FOR SELECT
  TO authenticated
  USING (true);

-- Only the service role (edge function) can write — no client-side writes allowed.
-- (No INSERT/UPDATE/DELETE policy = nobody on the anon/authenticated role can mutate.)

-- User preferences: opt-in flag for contributing to shared learning
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  contribute_to_shared_learning BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own preferences"
  ON public.user_preferences FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();