
ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS parent_collection_id uuid REFERENCES public.collection_suggestions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS colour_filter text,
  ADD COLUMN IF NOT EXISTS occasion_filter text,
  ADD COLUMN IF NOT EXISTS trend_signal text,
  ADD COLUMN IF NOT EXISTS trend_review_after timestamptz;

CREATE INDEX IF NOT EXISTS idx_collection_suggestions_parent ON public.collection_suggestions(parent_collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_suggestions_type ON public.collection_suggestions(collection_type);

ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS brand_voice_style text NOT NULL DEFAULT 'local_warmth'
    CHECK (brand_voice_style IN ('aspirational_youth','professional_editorial','local_warmth','luxury_refined'));

ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS whitefox_reference jsonb;

CREATE TABLE IF NOT EXISTS public.nested_handle_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL,
  parent_slug text NOT NULL,
  child_slug text NOT NULL,
  child_label text,
  dimension text,
  source text NOT NULL DEFAULT 'whitefox',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vertical, parent_slug, child_slug)
);

ALTER TABLE public.nested_handle_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nested_handle_map readable by authenticated" ON public.nested_handle_map;
CREATE POLICY "nested_handle_map readable by authenticated"
  ON public.nested_handle_map FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "nested_handle_map admin write" ON public.nested_handle_map;
CREATE POLICY "nested_handle_map admin write"
  ON public.nested_handle_map FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.nested_handle_map (vertical, parent_slug, child_slug, child_label, dimension, source) VALUES
  ('CLOTHING','dresses','mini-dresses','Mini Dresses','length','whitefox'),
  ('CLOTHING','dresses','maxi-dresses','Maxi Dresses','length','whitefox'),
  ('CLOTHING','dresses','midi-dresses','Midi Dresses','length','whitefox'),
  ('CLOTHING','dresses','party-dresses','Party Dresses','occasion','whitefox'),
  ('CLOTHING','dresses','formal-dresses','Formal Dresses','occasion','whitefox'),
  ('CLOTHING','dresses','day-dresses','Day Dresses','occasion','whitefox'),
  ('CLOTHING','dresses','long-sleeve-dresses','Long Sleeve Dresses','silhouette','whitefox'),
  ('CLOTHING','dresses','lace-dresses','Lace Dresses','trend','whitefox'),
  ('CLOTHING','dresses','strapless-dresses','Strapless Dresses','silhouette','whitefox'),
  ('CLOTHING','dresses','halter-dresses','Halter Dresses','silhouette','whitefox'),
  ('CLOTHING','dresses','black-dresses','Black Dresses','colour','whitefox'),
  ('CLOTHING','dresses','white-dresses','White Dresses','colour','whitefox'),
  ('CLOTHING','dresses','floral-dresses','Floral Dresses','colour','whitefox'),
  ('CLOTHING','dresses','sale-dresses','Sale Dresses','sale','whitefox'),
  ('CLOTHING','tops','going-out-tops','Going Out Tops','occasion','whitefox'),
  ('CLOTHING','tops','basic-tops','Basic Tops','silhouette','whitefox'),
  ('CLOTHING','tops','bodysuits','Bodysuits','silhouette','whitefox'),
  ('CLOTHING','tops','crop-tops','Crop Tops','silhouette','whitefox'),
  ('CLOTHING','tops','tank-tops','Tank Tops','silhouette','whitefox'),
  ('CLOTHING','tops','halter-tops','Halter Tops','silhouette','whitefox'),
  ('CLOTHING','tops','long-sleeve-tops','Long Sleeve Tops','silhouette','whitefox'),
  ('CLOTHING','tops','strapless-tops','Strapless Tops','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','bikinis','Bikinis','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','bikini-tops','Bikini Tops','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','bikini-bottoms','Bikini Bottoms','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','one-pieces','One Pieces','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','tankinis','Tankinis','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','cover-ups','Cover Ups','silhouette','whitefox'),
  ('SWIMWEAR','swimwear','resort-wear','Resort Wear','occasion','whitefox'),
  ('SWIMWEAR','swimwear','black-swimwear','Black Swimwear','colour','whitefox'),
  ('SWIMWEAR','swimwear','floral-swimwear','Floral Swimwear','colour','whitefox'),
  ('SWIMWEAR','swimwear','navy-swimwear','Navy Swimwear','colour','whitefox'),
  ('SWIMWEAR','swimwear','white-swimwear','White Swimwear','colour','whitefox'),
  ('SWIMWEAR','swimwear','tummy-control','Tummy Control','occasion','whitefox'),
  ('SWIMWEAR','swimwear','sale','Sale Swimwear','sale','whitefox'),
  ('FOOTWEAR','womens-shoes','heels','Heels','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','sandals','Sandals','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','boots','Boots','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','flats','Flats','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','sneakers','Sneakers','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','wedges','Wedges','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','loafers','Loafers','silhouette','whitefox'),
  ('FOOTWEAR','womens-shoes','black-shoes','Black Shoes','colour','whitefox'),
  ('FOOTWEAR','womens-shoes','tan-shoes','Tan Shoes','colour','whitefox'),
  ('FOOTWEAR','womens-shoes','work-shoes','Work Shoes','occasion','whitefox'),
  ('FOOTWEAR','womens-shoes','evening-shoes','Evening Shoes','occasion','whitefox'),
  ('FOOTWEAR','womens-shoes','sale','Sale Shoes','sale','whitefox'),
  ('FOOTWEAR','boots','ankle-boots','Ankle Boots','silhouette','whitefox'),
  ('FOOTWEAR','boots','chelsea-boots','Chelsea Boots','silhouette','whitefox'),
  ('FOOTWEAR','boots','knee-high-boots','Knee High Boots','silhouette','whitefox'),
  ('FOOTWEAR','boots','black-boots','Black Boots','colour','whitefox'),
  ('FOOTWEAR','boots','brown-boots','Brown Boots','colour','whitefox')
ON CONFLICT (vertical, parent_slug, child_slug) DO NOTHING;

ALTER TABLE public.seo_keyword_tiers DROP CONSTRAINT IF EXISTS seo_keyword_tiers_tier_check;
ALTER TABLE public.seo_keyword_tiers ADD CONSTRAINT seo_keyword_tiers_tier_check CHECK (tier BETWEEN 1 AND 6);

INSERT INTO public.seo_keyword_tiers (vertical, tier, keyword, placement_hint) VALUES
  ('CLOTHING', 2, 'mini dresses australia', 'product_type'),
  ('CLOTHING', 2, 'maxi dresses australia', 'product_type'),
  ('CLOTHING', 2, 'midi dresses australia', 'product_type'),
  ('CLOTHING', 2, 'party dresses australia', 'product_type'),
  ('CLOTHING', 2, 'formal dresses australia', 'product_type'),
  ('CLOTHING', 2, 'going out tops australia', 'product_type'),
  ('CLOTHING', 2, 'crop tops australia', 'product_type'),
  ('CLOTHING', 2, 'bodysuits australia', 'product_type'),
  ('CLOTHING', 2, 'two piece sets australia', 'product_type'),
  ('CLOTHING', 2, 'matching sets australia', 'product_type'),
  ('CLOTHING', 3, 'going out outfits australia', 'occasion'),
  ('CLOTHING', 3, 'festival outfits australia', 'occasion'),
  ('CLOTHING', 3, 'wedding guest dresses australia', 'occasion'),
  ('CLOTHING', 3, 'resort wear australia', 'occasion'),
  ('CLOTHING', 3, 'beach to bar outfits', 'occasion'),
  ('CLOTHING', 3, 'holiday outfits australia', 'occasion'),
  ('CLOTHING', 3, 'date night outfits australia', 'occasion'),
  ('CLOTHING', 3, 'brunch outfits australia', 'occasion'),
  ('CLOTHING', 4, 'dresses darwin', 'local'),
  ('CLOTHING', 4, 'boutique darwin', 'local'),
  ('CLOTHING', 4, 'clothing darwin nt', 'local'),
  ('CLOTHING', 4, 'darwin boutique online', 'local'),
  ('CLOTHING', 5, 'black mini dress australia', 'colour'),
  ('CLOTHING', 5, 'floral maxi dress australia', 'colour'),
  ('CLOTHING', 5, 'white bikini australia', 'colour'),
  ('CLOTHING', 5, 'black one piece swimsuit australia', 'colour'),
  ('CLOTHING', 6, 'lace dresses australia', 'trend'),
  ('CLOTHING', 6, 'crochet bikini australia', 'trend'),
  ('CLOTHING', 6, 'corset top australia', 'trend'),
  ('CLOTHING', 6, 'satin dress australia', 'trend'),
  ('CLOTHING', 6, 'matching lounge set australia', 'trend');
