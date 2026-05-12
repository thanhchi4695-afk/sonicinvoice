CREATE TABLE IF NOT EXISTS public.cron_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;
-- No policies => only service_role can access