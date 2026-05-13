ALTER TABLE public.gap_analysis_runs
  ADD COLUMN IF NOT EXISTS brands_checked integer NOT NULL DEFAULT 0;