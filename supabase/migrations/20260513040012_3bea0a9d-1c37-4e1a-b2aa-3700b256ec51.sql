CREATE TABLE public.brand_intelligence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  brand_name TEXT NOT NULL,
  brand_domain TEXT,
  collection_nav_urls JSONB DEFAULT '[]'::jsonb,
  category_vocabulary JSONB DEFAULT '{}'::jsonb,
  collection_structure_type TEXT CHECK (collection_structure_type IN ('silhouette','print_story','function','style_name','cup_size','mixed','unknown')),
  subcategory_list JSONB DEFAULT '[]'::jsonb,
  print_story_names JSONB DEFAULT '[]'::jsonb,
  seo_primary_keyword TEXT,
  seo_secondary_keywords JSONB DEFAULT '[]'::jsonb,
  brand_tone TEXT CHECK (brand_tone IN ('aspirational','edgy','functional','luxurious','inclusive','playful','unknown')),
  brand_tone_sample TEXT,
  blog_topics_used JSONB DEFAULT '[]'::jsonb,
  blog_sample_titles JSONB DEFAULT '[]'::jsonb,
  competitor_urls JSONB DEFAULT '[]'::jsonb,
  crawl_confidence NUMERIC(3,2) DEFAULT 0,
  crawl_status TEXT NOT NULL DEFAULT 'not_crawled' CHECK (crawl_status IN ('not_crawled','crawling','crawled','failed')),
  crawl_error TEXT,
  pages_fetched INT DEFAULT 0,
  last_crawled_at TIMESTAMPTZ,
  manually_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand_name)
);

CREATE INDEX idx_brand_intelligence_user ON public.brand_intelligence(user_id);
CREATE INDEX idx_brand_intelligence_brand ON public.brand_intelligence(lower(brand_name));

ALTER TABLE public.brand_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own brand intelligence"
  ON public.brand_intelligence FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own brand intelligence"
  ON public.brand_intelligence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own brand intelligence"
  ON public.brand_intelligence FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users delete own brand intelligence"
  ON public.brand_intelligence FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_brand_intelligence_updated_at
  BEFORE UPDATE ON public.brand_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();