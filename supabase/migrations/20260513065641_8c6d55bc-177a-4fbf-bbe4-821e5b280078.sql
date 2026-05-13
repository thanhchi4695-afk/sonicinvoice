INSERT INTO public.brand_intelligence (
  user_id, brand_name, brand_domain, industry_vertical,
  brand_tone, brand_tone_sample,
  seo_primary_keyword, seo_secondary_keywords,
  louenhide_megantic_reference,
  manually_verified, verified_at, crawl_status, crawl_confidence
) VALUES (
  '71057ef1-6417-4e3e-886b-288f9ed03d3b','Louenhide','louenhide.com.au','ACCESSORIES',
  'inclusive',
  'Designed in Brisbane, loved everywhere. Warm, friendly, accessible Australian voice — never luxury-cold. Founder-led, practical, confident.',
  'louenhide bags australia',
  to_jsonb(ARRAY['louenhide crossbody bag','vegan leather handbag australia','rfid blocking wallet women','louenhide black bag','everyday handbag darwin']),
  jsonb_build_object(
    'brand','Louenhide','voice','aussie_accessible',
    'founding_story','Founded 2005 in Brisbane by Louise Hennessy. Vegan leather since day one. Stocked in 600+ Australian boutiques.',
    'innovation_1_static_filter_collections', jsonb_build_object('principle','Filter intersections become static, indexable collections — never rely on Shopify dynamic ?filter= URLs.','examples', to_jsonb(ARRAY['/collections/black-bags','/collections/vegan-leather-crossbody','/collections/rfid-wallets','/collections/everyday-handbags'])),
    'innovation_2_niche_keywords', jsonb_build_object('principle','Never compete on broad heads. Always combine brand + type + feature/location.','avoid', to_jsonb(ARRAY['bags','wallets','handbags','accessories','online shopping']),'prefer', to_jsonb(ARRAY['louenhide black crossbody bag','rfid blocking wallet women australia','vegan leather handbag australia','everyday handbag darwin'])),
    'innovation_3_product_seo_compliance', jsonb_build_object('principle','Every product handle, H1, and meta description follows a strict niche-keyword pattern.','handle_format','{name}-{colour}-{material}-{type}','h1_format','{Name} {Colour} {Material} {Type}','meta_format','{Name} {Colour} {Material} {Type} by Louenhide. {feature}. Free shipping over $80. Shop now.'),
    'voice_phrases_to_use', to_jsonb(ARRAY['designed in Brisbane','everyday essentials','carries everything you need','vegan leather you''ll actually love','built for real life','from school run to dinner','our most-loved style']),
    'voice_phrases_to_avoid', to_jsonb(ARRAY['curated collection','timeless elegance','sophisticated silhouette','elevated essentials','discover','explore','indulge']),
    'body_formula', to_jsonb(ARRAY['Opening: brand-led, warm, primary keyword in sentence 1','Features: practical (RFID, vegan leather, pockets, adjustable strap)','Styling: real-life occasion (school run, weekend market, dinner)','Local hook: mention store city naturally','CTA: friendly']),
    'faq_questions', to_jsonb(ARRAY['Are Louenhide bags vegan?','Do Louenhide wallets have RFID protection?','Where are Louenhide bags designed?','How do I care for vegan leather?','Does {storeName} stock the full Louenhide range?','What is the warranty on Louenhide bags?'])
  ),
  true, now(), 'crawled', 0.95
)
RETURNING id;