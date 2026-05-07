CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'shopify',
  job_type TEXT NOT NULL DEFAULT 'catalog_sync',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  products_synced INTEGER NOT NULL DEFAULT 0,
  total_products INTEGER,
  last_page_cursor TEXT,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_status
  ON public.sync_jobs (user_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_platform_type
  ON public.sync_jobs (user_id, platform, job_type, started_at DESC);

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sync jobs" ON public.sync_jobs;
CREATE POLICY "Users can view their own sync jobs"
ON public.sync_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own sync jobs" ON public.sync_jobs;
CREATE POLICY "Users can create their own sync jobs"
ON public.sync_jobs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sync jobs" ON public.sync_jobs;
CREATE POLICY "Users can update their own sync jobs"
ON public.sync_jobs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_sync_jobs_updated_at ON public.sync_jobs;
CREATE TRIGGER update_sync_jobs_updated_at
BEFORE UPDATE ON public.sync_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();