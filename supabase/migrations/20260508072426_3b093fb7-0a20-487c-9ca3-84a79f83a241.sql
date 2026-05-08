CREATE TABLE IF NOT EXISTS public.brand_profiles (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_key          TEXT UNIQUE NOT NULL,
  supplier_name         TEXT NOT NULL,
  supplier_legal        TEXT,
  shopify_vendor        TEXT,
  confidence            INTEGER DEFAULT 65,
  invoices_processed    INTEGER DEFAULT 1,
  layout_type           TEXT,
  cost_column_name      TEXT,
  gst_inclusive_pricing BOOLEAN DEFAULT FALSE,
  rrp_on_invoice        BOOLEAN DEFAULT FALSE,
  known_sizes           TEXT[],
  known_colours         TEXT[],
  product_types         TEXT[],
  special_tag_rules     TEXT[],
  vendor_mapping        TEXT,
  notes                 TEXT,
  raw_md                TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_profiles_supplier_key ON public.brand_profiles(supplier_key);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_supplier_legal ON public.brand_profiles(supplier_legal);

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read brand_profiles" ON public.brand_profiles;
CREATE POLICY "Authenticated users can read brand_profiles"
  ON public.brand_profiles FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS update_brand_profiles_updated_at ON public.brand_profiles;
CREATE TRIGGER update_brand_profiles_updated_at
  BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.brand_profiles (
  supplier_key, supplier_name, supplier_legal, shopify_vendor,
  confidence, invoices_processed, created_at, updated_at
) VALUES
('seafolly','Seafolly','Seafolly Pty Limited','Seafolly',80,15,NOW(),NOW()),
('baku','Baku','Baku Australia Pty. Ltd.','Baku',80,10,NOW(),NOW()),
('bond-eye','Bond Eye','Bond-Eye Australia Pty Ltd','Bond Eye',80,4,NOW(),NOW()),
('jantzen','Jantzen','Skye Group Pty Ltd','Jantzen',85,8,NOW(),NOW()),
('sunseeker','Sunseeker','Sunseeker','Sunseeker',80,5,NOW(),NOW()),
('salty-ink','Salty Ink Kids','Salty Ink Pty. Ltd.','Salty Ink Kids',85,3,NOW(),NOW()),
('funkita','Funkita','Way Funky Company Pty Ltd','Funkita',80,2,NOW(),NOW()),
('reef','Reef','Reef Brazil (Aust.) Pty. Ltd.','Reef',80,2,NOW(),NOW()),
('speedo','Speedo','Speedo Australia Pty Ltd','Speedo',80,3,NOW(),NOW()),
('holster','Holster','Holster Fashion Pty Ltd','Holster',75,4,NOW(),NOW()),
('wacoal','Wacoal','Wacoal Australia Pty Ltd','Wacoal',80,3,NOW(),NOW()),
('sunshades-eyewear','Sunshades Eyewear','Sunshades Eyewear Pty Limited','Sunshades Eyewear',80,3,NOW(),NOW()),
('vacay','Vacay','Vacay Swimwear Pty Ltd','Vacay',80,2,NOW(),NOW()),
('zoggs','Zoggs','HEAD OCEANIA PTY LIMITED','Zoggs',70,1,NOW(),NOW()),
('nude-footwear','Nude Footwear','MAPM International Pty Ltd','Nude Footwear',75,1,NOW(),NOW()),
('glasshouse','Glasshouse Fragrances','Sapphire Group Pty Ltd','Glasshouse Fragrances',85,1,NOW(),NOW()),
('circa','Circa Home','Sapphire Group Pty Ltd','Circa Home',85,1,NOW(),NOW()),
('smelly-balls','Smelly Balls','Australian Lifestyle Brands Pty Ltd','Smelly Balls',65,1,NOW(),NOW()),
('bling2o','Bling2o','SAL&BE Pty Limited','Bling2o',65,1,NOW(),NOW()),
('italian-cartel','Italian Cartel','Senses Accessories Pty Ltd','Italian Cartel',70,1,NOW(),NOW()),
('jets','Jets','Seafolly Pty Limited','Jets',80,1,NOW(),NOW()),
('rusty','Rusty','Vegas Enterprises Pty Ltd','Rusty',70,1,NOW(),NOW()),
('frank-green','Frank Green','Frank Green Enterprises Pty Ltd','Frank Green',70,1,NOW(),NOW()),
('moe-moe','Moe Moe Design','Mizaku Pty. Ltd.','Moe Moe Design',70,1,NOW(),NOW()),
('love-luna','Love Luna','Ambra Corporation Pty Ltd','Love Luna',70,1,NOW(),NOW()),
('ambra','Ambra','Ambra Corporation Pty Ltd','Ambra',65,1,NOW(),NOW()),
('florabelle','Florabelle Living','Florabelle Imports Pty Ltd','Florabelle Living',70,1,NOW(),NOW()),
('light-and-glo','Light + Glo','LIGHT + GLO DESIGNS PTY LTD','Light + Glo',70,1,NOW(),NOW()),
('artesands','Artesands','Artesands Swimwear','Artesands',70,1,NOW(),NOW()),
('tigerlily','Tigerlily','Tigerlily Aust Pty Ltd','Tigerlily',65,3,NOW(),NOW()),
('hammamas','Hammamas','Hammamas Australasia Pty Ltd','Hammamas',70,1,NOW(),NOW()),
('budgy-smuggler','Budgy Smuggler','Budgy Smuggler','Budgy Smuggler',65,1,NOW(),NOW()),
('kulani-kinis','Kulani Kinis','Kulani Kinis Wholesale ROW','Kulani Kinis',65,1,NOW(),NOW()),
('capriosca','Capriosca','Capriosca Swimwear','Capriosca',65,1,NOW(),NOW()),
('monte-and-lou','Monte & Lou','MONTE AND LOU PTY LIMITED','Monte & Lou',75,1,NOW(),NOW()),
('rhythm','Rhythm Womens','RHYTHM GROUP PTY LTD','Rhythm Womens',70,1,NOW(),NOW()),
('auguste','Auguste','Auguste','Auguste',80,1,NOW(),NOW()),
('significant-other','Significant Other','Significant Other','Significant Other',80,1,NOW(),NOW()),
('olga-berg','Olga Berg','Olga Berg Design Pty Ltd','Olga Berg',85,1,NOW(),NOW()),
('rigon','Rigon','Rigon Pty Ltd','Rigon',70,1,NOW(),NOW()),
('summi-summi','Summi Summi','Summi Summi','Summi Summi',70,1,NOW(),NOW()),
('walnut-melbourne','Walnut Melbourne','Walnut Melbourne Pty Ltd','Walnut Melbourne',80,1,NOW(),NOW()),
('trelise-cooper','Trelise Cooper','Trelise Cooper','Trelise Cooper',80,1,NOW(),NOW()),
('g2m-miss-goodlife','Miss Goodlife','G2M Miss Goodlife','Miss Goodlife',80,1,NOW(),NOW()),
('bad-on-paper','Bad on Paper','Bad On Paper','Bad on Paper',70,1,NOW(),NOW()),
('bali-in-a-bottle','Bali In A Bottle','Bali In A Bottle','Bali In A Bottle',65,1,NOW(),NOW()),
('bebe-luxe','Bebe Luxe','Bebe Luxe','Bebe Luxe',65,1,NOW(),NOW()),
('blue-scarab','Blue Scarab','Blue Scarab Pty Ltd','Blue Scarab',65,1,NOW(),NOW()),
('by-frankie','By Frankie','By Frankie Clothing Pty Ltd','By Frankie',70,1,NOW(),NOW()),
('cinnamon','Cinnamon Creations','Cinnamon Creations','Cinnamon Creations',65,1,NOW(),NOW()),
('function-design','Function Design','Function Design Group Pty Ltd','Function Design',70,1,NOW(),NOW()),
('itami','Itami','Itami International Pty Ltd','Itami',70,1,NOW(),NOW()),
('lulalife','Lulalife','Function Design Group Pty Ltd','Lulalife',70,1,NOW(),NOW()),
('om-designs','OM Designs','OM Designs Australia Pty Ltd','OM Designs',65,1,NOW(),NOW()),
('rubyyaya','Rubyyaya','Function Design Group Pty Ltd','Rubyyaya',65,1,NOW(),NOW()),
('seven-wonders','Seven Wonders','PremGroup','Seven Wonders',65,1,NOW(),NOW()),
('skwosh','Skwosh','Skwosh','Skwosh',65,1,NOW(),NOW()),
('sky-gazer','Sky Gazer','Sky Gazer Wholesale','Sky Gazer',50,2,NOW(),NOW()),
('suit-saver','Suit Saver','SUIT SAVER','Suit Saver',65,1,NOW(),NOW()),
('sun-soul','Sun Soul','Sun Soul Australia','Sun Soul',65,1,NOW(),NOW()),
('the-commonfolk','The Commonfolk Collective','THE COMMONFOLK COLLECTIVE','The Commonfolk Collective',70,1,NOW(),NOW()),
('togs','Togs','Togs Swimwear Australia','Togs',75,1,NOW(),NOW())
ON CONFLICT (supplier_key) DO UPDATE SET
  shopify_vendor = EXCLUDED.shopify_vendor,
  supplier_legal = EXCLUDED.supplier_legal,
  confidence = GREATEST(public.brand_profiles.confidence, EXCLUDED.confidence),
  invoices_processed = GREATEST(public.brand_profiles.invoices_processed, EXCLUDED.invoices_processed),
  updated_at = NOW();