
-- collection_suggestions additions
ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS shopify_handle text,
  ADD COLUMN IF NOT EXISTS taxonomy_level smallint CHECK (taxonomy_level BETWEEN 2 AND 6),
  ADD COLUMN IF NOT EXISTS completeness_score smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completeness_breakdown jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_suggestions_user_handle
  ON public.collection_suggestions(user_id, shopify_handle)
  WHERE shopify_handle IS NOT NULL;

-- collection_seo_outputs additions
ALTER TABLE public.collection_seo_outputs
  ADD COLUMN IF NOT EXISTS faq_html text,
  ADD COLUMN IF NOT EXISTS formula_parts jsonb;

-- brand_intelligence addition
ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS iconic_reference jsonb;

-- collection_link_mesh
CREATE TABLE IF NOT EXISTS public.collection_link_mesh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_collection_id uuid NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  target_collection_id uuid NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('sibling','parent','child','occasion','material','brand')),
  anchor_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_collection_id, target_collection_id, link_type)
);
CREATE INDEX IF NOT EXISTS idx_link_mesh_source ON public.collection_link_mesh(source_collection_id);
CREATE INDEX IF NOT EXISTS idx_link_mesh_user ON public.collection_link_mesh(user_id);

ALTER TABLE public.collection_link_mesh ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own link mesh" ON public.collection_link_mesh
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own link mesh" ON public.collection_link_mesh
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own link mesh" ON public.collection_link_mesh
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own link mesh" ON public.collection_link_mesh
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- seo_keyword_tiers
CREATE TABLE IF NOT EXISTS public.seo_keyword_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 5),
  vertical text NOT NULL,
  keyword text NOT NULL,
  region text,
  placement_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier, vertical, keyword, region)
);
CREATE INDEX IF NOT EXISTS idx_keyword_tiers_lookup ON public.seo_keyword_tiers(vertical, tier);

ALTER TABLE public.seo_keyword_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read keyword tiers"
  ON public.seo_keyword_tiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage keyword tiers"
  ON public.seo_keyword_tiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
