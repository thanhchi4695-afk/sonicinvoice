
-- Collection suggestions
CREATE TABLE public.collection_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_domain TEXT,
  collection_type TEXT NOT NULL CHECK (collection_type IN ('brand','brand_category','type','niche','print','archive')),
  suggested_title TEXT NOT NULL,
  suggested_handle TEXT NOT NULL,
  rule_set JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_count INT NOT NULL DEFAULT 0,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  sample_product_ids TEXT[] NOT NULL DEFAULT '{}',
  sample_titles TEXT[] NOT NULL DEFAULT '{}',
  sample_images TEXT[] NOT NULL DEFAULT '{}',
  seo_title TEXT,
  seo_description TEXT,
  description_html TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','content_generating','content_ready','approved','rejected','published','error')),
  shopify_collection_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, suggested_handle)
);
CREATE INDEX idx_collection_suggestions_user_status ON public.collection_suggestions(user_id, status);
ALTER TABLE public.collection_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.collection_suggestions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.collection_suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.collection_suggestions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.collection_suggestions FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER tr_collection_suggestions_updated BEFORE UPDATE ON public.collection_suggestions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Collection blogs
CREATE TABLE public.collection_blogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  blog_type TEXT NOT NULL CHECK (blog_type IN ('sizing','care','features','faq')),
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published')),
  shopify_blog_id TEXT,
  shopify_article_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_collection_blogs_user_status ON public.collection_blogs(user_id, status);
ALTER TABLE public.collection_blogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.collection_blogs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.collection_blogs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.collection_blogs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.collection_blogs FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER tr_collection_blogs_updated BEFORE UPDATE ON public.collection_blogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Collection scans
CREATE TABLE public.collection_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_domain TEXT,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('product_push','manual','cron')),
  products_scanned INT NOT NULL DEFAULT 0,
  suggestions_created INT NOT NULL DEFAULT 0,
  archive_candidates INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX idx_collection_scans_user ON public.collection_scans(user_id, started_at DESC);
ALTER TABLE public.collection_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.collection_scans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.collection_scans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.collection_scans FOR UPDATE USING (auth.uid() = user_id);
