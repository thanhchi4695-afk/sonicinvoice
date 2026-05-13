-- Competitor gaps detected by the AI agent
CREATE TABLE public.competitor_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id uuid,
  competitor_name text NOT NULL,
  competitor_url text NOT NULL,
  gap_type text NOT NULL CHECK (gap_type IN ('brand_type','colour','occasion','intersection','depth')),
  brand text,
  product_count_in_store integer DEFAULT 0,
  suggested_handle text NOT NULL,
  suggested_title text NOT NULL,
  suggested_description text,
  smart_rule_column text,
  smart_rule_relation text,
  smart_rule_condition text,
  competitor_framing text NOT NULL,
  expected_impact text NOT NULL DEFAULT 'medium' CHECK (expected_impact IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed','created')),
  shopify_collection_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_competitor_gaps_user ON public.competitor_gaps(user_id, status);
CREATE INDEX idx_competitor_gaps_run ON public.competitor_gaps(run_id);
CREATE UNIQUE INDEX idx_competitor_gaps_user_handle ON public.competitor_gaps(user_id, suggested_handle) WHERE status <> 'dismissed';

ALTER TABLE public.competitor_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own gaps" ON public.competitor_gaps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users update own gaps" ON public.competitor_gaps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users delete own gaps" ON public.competitor_gaps FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "users insert own gaps" ON public.competitor_gaps FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_competitor_gaps_updated
  BEFORE UPDATE ON public.competitor_gaps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-run log
CREATE TABLE public.gap_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed')),
  current_step text,
  gaps_found integer NOT NULL DEFAULT 0,
  competitor_stores_checked integer NOT NULL DEFAULT 0,
  vertical text,
  error_message text
);
CREATE INDEX idx_gap_runs_user ON public.gap_analysis_runs(user_id, started_at DESC);

ALTER TABLE public.gap_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own runs" ON public.gap_analysis_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own runs" ON public.gap_analysis_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own runs" ON public.gap_analysis_runs FOR UPDATE USING (auth.uid() = user_id);