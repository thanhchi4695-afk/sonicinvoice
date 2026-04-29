-- Image SEO jobs: tracks every optimized image (URL, Shopify, or upload origin)
CREATE TABLE IF NOT EXISTS public.image_seo_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('url','shopify','upload')),
  source_ref TEXT,
  product_id TEXT,
  product_handle TEXT,
  product_title TEXT,
  vendor TEXT,
  original_url TEXT,
  original_size INTEGER,
  original_content_type TEXT,
  new_url TEXT,
  new_size INTEGER,
  new_filename TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  savings_pct INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','error','pushed')),
  error TEXT,
  shopify_pushed_at TIMESTAMPTZ,
  shopify_media_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_seo_jobs_user_created ON public.image_seo_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_seo_jobs_status ON public.image_seo_jobs(user_id, status);

ALTER TABLE public.image_seo_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own image seo jobs"
  ON public.image_seo_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own image seo jobs"
  ON public.image_seo_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own image seo jobs"
  ON public.image_seo_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own image seo jobs"
  ON public.image_seo_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_image_seo_jobs_updated_at
  BEFORE UPDATE ON public.image_seo_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();