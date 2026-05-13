-- Industry taxonomy library
CREATE TABLE public.industry_taxonomy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vertical TEXT NOT NULL CHECK (vertical IN ('FOOTWEAR','SWIMWEAR','CLOTHING','ACCESSORIES','LIFESTYLE')),
  dimension_name TEXT NOT NULL,
  dimension_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_collection_trigger BOOLEAN NOT NULL DEFAULT true,
  min_products_to_trigger INT NOT NULL DEFAULT 5,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vertical, dimension_name)
);

CREATE INDEX idx_industry_taxonomy_vertical ON public.industry_taxonomy(vertical);

ALTER TABLE public.industry_taxonomy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read taxonomy"
  ON public.industry_taxonomy FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage taxonomy"
  ON public.industry_taxonomy FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_industry_taxonomy_updated_at
  BEFORE UPDATE ON public.industry_taxonomy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.industry_taxonomy (vertical, dimension_name, dimension_values, min_products_to_trigger, display_order) VALUES
('FOOTWEAR','shoe_type','["heel","flat","sandal","boot","ankle boot","knee-high boot","sneaker","loafer","mule","slide","wedge","thong","ballet flat","dress shoe","boat shoe","oxford","monk strap"]'::jsonb,5,1),
('FOOTWEAR','heel_height','["flat","low","mid","high","block heel","stiletto","kitten heel","wedge heel"]'::jsonb,5,2),
('FOOTWEAR','toe_shape','["pointed","round","square","open toe","peep toe","almond"]'::jsonb,5,3),
('FOOTWEAR','material','["leather","suede","patent leather","canvas","synthetic","vegan leather","fabric","metallic"]'::jsonb,5,4),
('FOOTWEAR','occasion','["casual","work","evening","wedding","sport","beach","travel"]'::jsonb,5,5),
('FOOTWEAR','comfort_feature','["memory foam","arch support","wide fit","cushioned","ortholite","podiatrist approved","orthopaedic"]'::jsonb,3,6),
('FOOTWEAR','closure','["slip on","lace up","buckle","zip","velcro","elastic","ankle strap"]'::jsonb,5,7),
('FOOTWEAR','gender','["womens","mens","kids","unisex"]'::jsonb,5,8),
('FOOTWEAR','season','["summer","winter","transitional","year-round"]'::jsonb,5,9),
('SWIMWEAR','garment_type','["bikini top","bikini bottom","one piece","tankini top","tankini bottom","rash vest","boardshort","cover up","kaftan","sarong"]'::jsonb,3,1),
('SWIMWEAR','silhouette','["halter","bandeau","triangle","underwire","bralette","crop top","longline","tie front","push up"]'::jsonb,5,2),
('SWIMWEAR','bottom_style','["hipster","cheeky","high waist","boyleg","brief","tie side","thong","mid rise"]'::jsonb,5,3),
('SWIMWEAR','cup_size','["A-C","D-DD","E-F","G+","moulded","soft cup","underwire"]'::jsonb,5,4),
('SWIMWEAR','function','["tummy control","mastectomy","chlorine resistant","UPF 50+","padded","bust support","eco","sustainable"]'::jsonb,3,5),
('SWIMWEAR','print_story','["solid","floral","animal","stripe","abstract","tropical","geometric","tie dye"]'::jsonb,5,6),
('SWIMWEAR','gender','["womens","mens","girls","boys","kids"]'::jsonb,5,7),
('CLOTHING','garment_type','["dress","top","shirt","blouse","pants","shorts","skirt","jacket","coat","jumpsuit","playsuit","vest","cardigan"]'::jsonb,5,1),
('CLOTHING','dress_style','["maxi","midi","mini","wrap","shift","bodycon","sundress","shirt dress","evening","formal"]'::jsonb,5,2),
('CLOTHING','occasion','["casual","work","evening","wedding guest","resort","activewear"]'::jsonb,5,3),
('CLOTHING','fit','["relaxed","fitted","oversized","tailored","stretch"]'::jsonb,5,4),
('CLOTHING','fabric','["linen","cotton","silk","denim","knit","chiffon","jersey"]'::jsonb,5,5),
('CLOTHING','print_story','["solid","floral","stripe","animal","abstract","check"]'::jsonb,5,6),
('ACCESSORIES','accessory_type','["tote","crossbody","clutch","backpack","shoulder bag","wallet","purse","earrings","necklace","bracelet","ring","sunglasses","hat","scarf","belt"]'::jsonb,3,1),
('ACCESSORIES','material','["leather","vegan leather","canvas","fabric","metal","beaded","straw"]'::jsonb,5,2),
('ACCESSORIES','occasion','["everyday","work","evening","beach","travel","wedding"]'::jsonb,5,3),
('ACCESSORIES','size','["mini","small","medium","large","oversized"]'::jsonb,5,4),
('ACCESSORIES','closure','["zip","magnetic","clasp","open top","drawstring"]'::jsonb,5,5),
('LIFESTYLE','product_type','["candle","diffuser","body lotion","soap","room spray","gift set","home fragrance"]'::jsonb,3,1),
('LIFESTYLE','scent_family','["floral","citrus","woody","fresh","oriental","seasonal"]'::jsonb,5,2),
('LIFESTYLE','size','["travel","small","medium","large","gift size"]'::jsonb,5,3),
('LIFESTYLE','occasion','["everyday","gifting","seasonal","self care"]'::jsonb,5,4);

-- brand_intelligence v2 columns
ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS industry_vertical TEXT DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS collection_nav_structure JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS collection_structure_secondary TEXT,
  ADD COLUMN IF NOT EXISTS blog_topic_distribution JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.brand_intelligence DROP CONSTRAINT IF EXISTS brand_intelligence_industry_vertical_check;
ALTER TABLE public.brand_intelligence ADD CONSTRAINT brand_intelligence_industry_vertical_check
  CHECK (industry_vertical IN ('FOOTWEAR','SWIMWEAR','CLOTHING','ACCESSORIES','LIFESTYLE','MULTI','UNKNOWN'));

ALTER TABLE public.brand_intelligence DROP CONSTRAINT IF EXISTS brand_intelligence_collection_structure_type_check;
ALTER TABLE public.brand_intelligence ADD CONSTRAINT brand_intelligence_collection_structure_type_check
  CHECK (collection_structure_type IS NULL OR collection_structure_type IN ('silhouette','print_story','function','style_name','cup_size','technology','occasion','material','gender_age','mixed','unknown'));

ALTER TABLE public.brand_intelligence DROP CONSTRAINT IF EXISTS brand_intelligence_collection_structure_secondary_check;
ALTER TABLE public.brand_intelligence ADD CONSTRAINT brand_intelligence_collection_structure_secondary_check
  CHECK (collection_structure_secondary IS NULL OR collection_structure_secondary IN ('silhouette','print_story','function','style_name','cup_size','technology','occasion','material','gender_age','mixed','unknown'));

-- Kill switch on existing app_settings singleton
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS brand_intelligence_enabled BOOLEAN NOT NULL DEFAULT true;