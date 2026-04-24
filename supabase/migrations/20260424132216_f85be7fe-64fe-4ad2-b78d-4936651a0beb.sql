-- Monthly reset for agent budgets (per-user + global)
-- Runs at 00:05 UTC on the 1st of each month.

CREATE OR REPLACE FUNCTION public.reset_agent_budgets_monthly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_budgets
     SET spent_cents = 0,
         degraded = false,
         month_start = date_trunc('month', current_date)::date,
         last_reset_at = now()
   WHERE month_start < date_trunc('month', current_date)::date;

  UPDATE public.agent_global_budget
     SET spent_cents = 0,
         month_start = date_trunc('month', current_date)::date
   WHERE month_start < date_trunc('month', current_date)::date;
END;
$$;

-- Schedule via pg_cron (idempotent: unschedule any prior version first)
DO $$
BEGIN
  PERFORM cron.unschedule('reset-agent-budgets-monthly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-agent-budgets-monthly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reset-agent-budgets-monthly',
  '5 0 1 * *',
  $$ SELECT public.reset_agent_budgets_monthly(); $$
);