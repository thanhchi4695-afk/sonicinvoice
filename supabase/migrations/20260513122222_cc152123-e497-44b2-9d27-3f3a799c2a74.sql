ALTER TABLE public.industry_taxonomy DROP CONSTRAINT industry_taxonomy_vertical_check;
ALTER TABLE public.industry_taxonomy ADD CONSTRAINT industry_taxonomy_vertical_check
  CHECK (vertical = ANY (ARRAY['FOOTWEAR','SWIMWEAR','CLOTHING','ACCESSORIES','LIFESTYLE','JEWELLERY']));

ALTER TABLE public.seo_keyword_library DROP CONSTRAINT seo_keyword_library_vertical_check;
ALTER TABLE public.seo_keyword_library ADD CONSTRAINT seo_keyword_library_vertical_check
  CHECK (vertical = ANY (ARRAY['FOOTWEAR','SWIMWEAR','CLOTHING','ACCESSORIES','LIFESTYLE','MULTI','JEWELLERY']));

ALTER TABLE public.seo_keyword_library DROP CONSTRAINT seo_keyword_library_bucket_check;
ALTER TABLE public.seo_keyword_library ADD CONSTRAINT seo_keyword_library_bucket_check
  CHECK (bucket = ANY (ARRAY['high_volume','type_specific','local','brand_long_tail','occasion','material','colour','feature','gifting','metal','gemstone','style','theme']));