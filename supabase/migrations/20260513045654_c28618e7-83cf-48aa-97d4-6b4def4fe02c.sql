
ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS competitor_reference_styletread jsonb;

CREATE TABLE IF NOT EXISTS public.seo_keyword_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL CHECK (vertical IN ('FOOTWEAR','SWIMWEAR','CLOTHING','ACCESSORIES','LIFESTYLE','MULTI')),
  bucket text NOT NULL CHECK (bucket IN ('high_volume','type_specific','local','brand_long_tail','occasion','material','colour','feature')),
  keyword text NOT NULL,
  region text NOT NULL DEFAULT 'AU',
  city text,
  search_intent text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_skl_keyword
  ON public.seo_keyword_library (vertical, bucket, lower(keyword), region, COALESCE(city,''));
CREATE INDEX IF NOT EXISTS idx_skl_vertical_bucket ON public.seo_keyword_library (vertical, bucket);

ALTER TABLE public.seo_keyword_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skl read auth" ON public.seo_keyword_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "skl write admin/buyer" ON public.seo_keyword_library FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'));
CREATE TRIGGER trg_skl_updated BEFORE UPDATE ON public.seo_keyword_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.collection_seo_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  layer smallint NOT NULL CHECK (layer BETWEEN 1 AND 4),
  seo_title text,
  meta_description text,
  description_html text,
  smart_rules_json jsonb,
  rules_validated_count integer DEFAULT 0,
  rules_status text DEFAULT 'pending' CHECK (rules_status IN ('pending','ok','empty','needs_review')),
  status text DEFAULT 'draft' CHECK (status IN ('draft','approved','published')),
  validation_errors jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suggestion_id)
);
CREATE INDEX IF NOT EXISTS idx_cso_status ON public.collection_seo_outputs (status);
CREATE INDEX IF NOT EXISTS idx_cso_layer ON public.collection_seo_outputs (layer);
ALTER TABLE public.collection_seo_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cso read auth" ON public.collection_seo_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "cso write admin/buyer" ON public.collection_seo_outputs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'));
CREATE TRIGGER trg_cso_updated BEFORE UPDATE ON public.collection_seo_outputs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.collection_blog_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  blog_index smallint NOT NULL DEFAULT 1,
  title text NOT NULL,
  target_keywords text[] DEFAULT '{}',
  sections jsonb DEFAULT '[]'::jsonb,
  faq jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'plan' CHECK (status IN ('plan','approved','generated')),
  generated_html text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suggestion_id, blog_index)
);
CREATE INDEX IF NOT EXISTS idx_cbp_status ON public.collection_blog_plans (status);
ALTER TABLE public.collection_blog_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cbp read auth" ON public.collection_blog_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "cbp write admin/buyer" ON public.collection_blog_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'buyer'));
CREATE TRIGGER trg_cbp_updated BEFORE UPDATE ON public.collection_blog_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pre-seed keyword library
INSERT INTO public.seo_keyword_library (vertical, bucket, keyword, region, city, search_intent) VALUES
('FOOTWEAR','high_volume','womens shoes australia','AU',NULL,'broad'),
('FOOTWEAR','high_volume','buy shoes online australia','AU',NULL,'broad'),
('FOOTWEAR','high_volume','womens heels','AU',NULL,'broad'),
('FOOTWEAR','high_volume','sandals australia','AU',NULL,'broad'),
('FOOTWEAR','high_volume','boots australia','AU',NULL,'broad'),
('FOOTWEAR','high_volume','sneakers australia','AU',NULL,'broad'),
('FOOTWEAR','type_specific','womens ankle boots australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','block heels australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','leather sandals australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','ballet flats australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','womens loafers australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','mule shoes australia','AU',NULL,'type'),
('FOOTWEAR','type_specific','wedge sandals australia','AU',NULL,'type'),
('FOOTWEAR','local','shoes darwin','AU','Darwin','local'),
('FOOTWEAR','local','shoe shop darwin','AU','Darwin','local'),
('FOOTWEAR','local','buy shoes darwin nt','AU','Darwin','local'),
('FOOTWEAR','local','darwin shoe store','AU','Darwin','local'),
('FOOTWEAR','local','comfort shoes darwin','AU','Darwin','local'),
('FOOTWEAR','local','work shoes darwin','AU','Darwin','local'),
('FOOTWEAR','local','formal shoes darwin','AU','Darwin','local'),
('FOOTWEAR','local','darwin races shoes','AU','Darwin','local'),
('FOOTWEAR','brand_long_tail','mollini heels','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','mollini sandals','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','mollini boots','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','walnut melbourne boots','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','walnut melbourne sandals','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','django juliette boots australia','AU',NULL,'brand'),
('FOOTWEAR','brand_long_tail','colorado shoes australia','AU',NULL,'brand'),
('FOOTWEAR','occasion','work shoes women australia','AU',NULL,'commercial'),
('FOOTWEAR','occasion','wedding shoes australia','AU',NULL,'commercial'),
('FOOTWEAR','occasion','evening shoes australia','AU',NULL,'commercial'),
('FOOTWEAR','occasion','comfortable walking shoes australia','AU',NULL,'commercial'),
('FOOTWEAR','occasion','wide fit shoes australia','AU',NULL,'commercial'),
('FOOTWEAR','occasion','arch support shoes','AU',NULL,'commercial'),
('FOOTWEAR','material','leather heels australia','AU',NULL,'material'),
('FOOTWEAR','material','suede boots australia','AU',NULL,'material'),
('FOOTWEAR','material','vegan shoes australia','AU',NULL,'material'),
('FOOTWEAR','material','patent leather shoes','AU',NULL,'material'),
('FOOTWEAR','material','tan leather shoes','AU',NULL,'material'),
('FOOTWEAR','colour','black boots australia','AU',NULL,'colour'),
('FOOTWEAR','colour','tan shoes australia','AU',NULL,'colour'),
('FOOTWEAR','colour','nude heels australia','AU',NULL,'colour'),
('FOOTWEAR','colour','leopard print shoes','AU',NULL,'colour'),
('FOOTWEAR','colour','chocolate brown boots','AU',NULL,'colour'),
('SWIMWEAR','high_volume','one piece swimsuit australia','AU',NULL,'broad'),
('SWIMWEAR','high_volume','bikini tops australia','AU',NULL,'broad'),
('SWIMWEAR','high_volume','womens swimwear australia','AU',NULL,'broad'),
('SWIMWEAR','high_volume','buy swimwear online australia','AU',NULL,'broad'),
('SWIMWEAR','brand_long_tail','seafolly one piece','AU',NULL,'brand'),
('SWIMWEAR','brand_long_tail','seafolly bikini','AU',NULL,'brand'),
('SWIMWEAR','brand_long_tail','bond eye swimwear','AU',NULL,'brand'),
('SWIMWEAR','brand_long_tail','sea level swimwear','AU',NULL,'brand'),
('SWIMWEAR','brand_long_tail','baku bikini','AU',NULL,'brand'),
('SWIMWEAR','feature','tummy control swimwear australia','AU',NULL,'commercial'),
('SWIMWEAR','feature','dd cup bikini','AU',NULL,'commercial'),
('SWIMWEAR','feature','mastectomy swimwear australia','AU',NULL,'commercial'),
('SWIMWEAR','feature','upf 50 swimwear','AU',NULL,'commercial'),
('SWIMWEAR','feature','chlorine resistant swimwear','AU',NULL,'commercial'),
('SWIMWEAR','local','swimwear darwin','AU','Darwin','local'),
('SWIMWEAR','local','buy swimwear darwin','AU','Darwin','local'),
('SWIMWEAR','local','swimwear shop darwin nt','AU','Darwin','local')
ON CONFLICT DO NOTHING;
