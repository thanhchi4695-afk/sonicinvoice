ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS enrichment_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enrichment_completed_at timestamptz;