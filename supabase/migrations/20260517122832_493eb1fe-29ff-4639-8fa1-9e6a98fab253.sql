
ALTER TABLE public.brand_intelligence
  DROP CONSTRAINT IF EXISTS brand_intelligence_crawl_status_check;

ALTER TABLE public.brand_intelligence
  ADD CONSTRAINT brand_intelligence_crawl_status_check
  CHECK (crawl_status IN ('not_crawled', 'crawling', 'completed', 'failed', 'crawled'));

UPDATE public.brand_intelligence
   SET crawl_status = 'completed'
 WHERE crawl_status = 'crawled';

ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS priority smallint,
  ADD COLUMN IF NOT EXISTS needs_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS size_range text,
  ADD COLUMN IF NOT EXISTS key_fabric_technologies jsonb,
  ADD COLUMN IF NOT EXISTS price_range_aud jsonb,
  ADD COLUMN IF NOT EXISTS collections_created integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS brand_intelligence_priority_idx
  ON public.brand_intelligence (user_id, priority)
  WHERE priority IS NOT NULL;
