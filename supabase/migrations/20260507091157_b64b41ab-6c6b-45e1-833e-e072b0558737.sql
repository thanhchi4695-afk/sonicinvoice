CREATE TABLE IF NOT EXISTS public.product_enrichment_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shopify_product_id  TEXT NOT NULL,
  shopify_handle      TEXT NOT NULL,
  shopify_variant_id  TEXT,
  product_title       TEXT,
  vendor              TEXT,
  style_number        TEXT,
  colour              TEXT,
  supplier_url        TEXT,
  product_page_url    TEXT,
  url_confidence      TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  scraped_images      JSONB DEFAULT '[]',
  scraped_description TEXT,
  scrape_source       TEXT,
  ai_description      TEXT,
  ai_seo_title        TEXT,
  ai_seo_description  TEXT,
  image_alt_text      TEXT,
  retry_count         INT NOT NULL DEFAULT 0,
  max_retries         INT NOT NULL DEFAULT 8,
  last_attempted      TIMESTAMPTZ,
  next_retry_at       TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  approved_by         TEXT,
  pushed_at           TIMESTAMPTZ,
  push_error          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peq_user_status
  ON public.product_enrichment_queue (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_peq_retry
  ON public.product_enrichment_queue (status, next_retry_at)
  WHERE status = 'not_found' AND retry_count < max_retries;

CREATE INDEX IF NOT EXISTS idx_peq_shopify_product
  ON public.product_enrichment_queue (user_id, shopify_product_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_peq_unique_product
  ON public.product_enrichment_queue (user_id, shopify_product_id);

ALTER TABLE public.product_enrichment_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_enrichment_queue"
  ON public.product_enrichment_queue FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_enrichment_queue_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_peq_updated_at ON public.product_enrichment_queue;
CREATE TRIGGER trg_peq_updated_at
  BEFORE UPDATE ON public.product_enrichment_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_enrichment_queue_updated_at();