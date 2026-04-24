-- ── Brand registry: pre-seeded supplier websites ──────────────────────
create table if not exists public.supplier_websites (
  id uuid primary key default gen_random_uuid(),
  brand_name_normalised text not null unique,
  brand_name_display text not null,
  website_url text,
  is_shopify boolean not null default false,
  products_json_endpoint text,
  enrichment_enabled boolean not null default true,
  cache_ttl_hours integer not null default 24,
  last_scraped_at timestamptz,
  scrape_failure_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_websites_normalised
  on public.supplier_websites (brand_name_normalised);

alter table public.supplier_websites enable row level security;

-- Anyone signed in can READ the brand registry (it's a shared public-good list)
create policy "Authenticated users can read supplier websites"
  on public.supplier_websites for select to authenticated using (true);

-- Only admins can write/edit the registry
create policy "Admins can insert supplier websites"
  on public.supplier_websites for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Admins can update supplier websites"
  on public.supplier_websites for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Admins can delete supplier websites"
  on public.supplier_websites for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- updated_at trigger
create trigger trg_supplier_websites_updated_at
  before update on public.supplier_websites
  for each row execute function public.update_updated_at_column();


-- ── Lookup misses: per-user log of un-registered brands ──────────────
create table if not exists public.brand_lookup_misses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  raw_brand text not null,
  normalised text not null,
  occurred_at timestamptz not null default now(),
  occurrence_count integer not null default 1
);

create index if not exists idx_brand_lookup_misses_user_normalised
  on public.brand_lookup_misses (user_id, normalised);

alter table public.brand_lookup_misses enable row level security;

create policy "Own brand lookup misses"
  on public.brand_lookup_misses for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Seed: 35 verified Australian retail brand sites ──────────────────
insert into public.supplier_websites
  (brand_name_normalised, brand_name_display, website_url, is_shopify, products_json_endpoint, notes)
values
  ('walnut melbourne', 'Walnut Melbourne', 'https://www.walnutmelbourne.com', true, 'https://www.walnutmelbourne.com/products.json?limit=250', 'Multi-product slugs disambiguated by -1/-2. Match by name+colour.'),
  ('seafolly', 'Seafolly', 'https://au.seafolly.com', true, 'https://au.seafolly.com/products.json?limit=250', 'Use AU subdomain (.com redirects to US).'),
  ('baku', 'Baku Swimwear', 'https://bakuswimwear.com.au', true, 'https://bakuswimwear.com.au/products.json?limit=250', null),
  ('baku swimwear', 'Baku Swimwear', 'https://bakuswimwear.com.au', true, 'https://bakuswimwear.com.au/products.json?limit=250', 'Alias of baku'),
  ('sea level', 'Sea Level Australia', 'https://sealevelaustralia.com.au', true, 'https://sealevelaustralia.com.au/products.json?limit=250', 'Use .com.au not .com (US site).'),
  ('sea level australia', 'Sea Level Australia', 'https://sealevelaustralia.com.au', true, 'https://sealevelaustralia.com.au/products.json?limit=250', 'Alias of sea level'),
  ('jantzen', 'Jantzen', 'https://jantzen.com.au', false, null, 'NOT Shopify (.asp pages) — needs HTML scraper or Google fallback.'),
  ('sunseeker', 'Sunseeker Swim', 'https://sunseekerswim.com.au', false, null, 'NOT Shopify (.asp pages).'),
  ('sunseeker swim', 'Sunseeker Swim', 'https://sunseekerswim.com.au', false, null, 'Alias of sunseeker'),
  ('bond eye', 'Bond-Eye', 'https://bond-eye.com', true, 'https://bond-eye.com/products.json?limit=250', 'Hyphenated domain.'),
  ('bondeye', 'Bond-Eye', 'https://bond-eye.com', true, 'https://bond-eye.com/products.json?limit=250', 'Alias.'),
  ('funkita', 'Funkita', 'https://www.funkita.com', true, 'https://www.funkita.com/products.json?limit=250', 'Way Funky brand.'),
  ('funky trunks', 'Funky Trunks', 'https://www.funkytrunks.com', true, 'https://www.funkytrunks.com/products.json?limit=250', 'Way Funky brand.'),
  ('jets', 'Jets Swimwear', 'https://jetsswimwear.com', true, 'https://jetsswimwear.com/products.json?limit=250', null),
  ('jets swimwear', 'Jets Swimwear', 'https://jetsswimwear.com', true, 'https://jetsswimwear.com/products.json?limit=250', 'Alias of jets'),
  ('artesands', 'Artesands', 'https://artesands.com', true, 'https://artesands.com/products.json?limit=250', 'Plus-size/curve swimwear.'),
  ('monte and lou', 'Monte & Lou', 'https://monteandlou.com', true, 'https://monteandlou.com/products.json?limit=250', null),
  ('rhythm', 'Rhythm', 'https://au.rhythmlivin.com', true, 'https://au.rhythmlivin.com/products.json?limit=250', 'Use AU subdomain.'),
  ('reef', 'Reef', 'https://shop-reef.com.au', true, 'https://shop-reef.com.au/products.json?limit=250', 'AU distributor site.'),
  ('pops plus co', 'Pops + Co', 'https://popsplusco.com.au', true, 'https://popsplusco.com.au/products.json?limit=250', null),
  ('tigerlily', 'Tigerlily', 'https://tigerlily.com.au', true, 'https://tigerlily.com.au/products.json?limit=250', null),
  ('salty ink', 'Salty Ink', 'https://saltyinkdesigns.com.au', true, 'https://saltyinkdesigns.com.au/products.json?limit=250', 'Includes Lil Sista 0-7 and Sista 8-16 kids ranges.'),
  ('salty ink kids', 'Salty Ink', 'https://saltyinkdesigns.com.au', true, 'https://saltyinkdesigns.com.au/products.json?limit=250', 'Same store as Salty Ink.'),
  ('capriosca', 'Capriosca', 'https://caprioscaswimwear.com.au', true, 'https://caprioscaswimwear.com.au/products.json?limit=250', null),
  ('by charlotte', 'by charlotte', 'https://bycharlotte.com.au', true, 'https://bycharlotte.com.au/products.json?limit=250', 'Sydney jewellery.'),
  ('holster', 'Holster Fashion', 'https://www.holsterfashion.com', true, 'https://www.holsterfashion.com/products.json?limit=250', 'Vegan footwear.'),
  ('hammamas', 'Hammamas', 'https://hammamas.com.au', true, 'https://hammamas.com.au/products.json?limit=250', 'Turkish towels.'),
  ('le specs', 'Le Specs', 'https://au.lespecs.com', true, 'https://au.lespecs.com/products.json?limit=250', 'Use AU subdomain.'),
  ('sunnylife', 'SUNNYLiFE', 'https://www.sunnylife.com.au', true, 'https://www.sunnylife.com.au/products.json?limit=250', 'Beach accessories.'),
  ('kulani kinis', 'Kulani Kinis', 'https://www.kulanikinis.com.au', true, 'https://www.kulanikinis.com.au/products.json?limit=250', 'Use .com.au.'),
  ('sky gazer', 'Sky Gazer', 'https://skygazerculture.com', true, 'https://skygazerculture.com/products.json?limit=250', 'Lifestyle accessories — NOT eyewear.'),
  ('speedo', 'Speedo Australia', 'https://www.speedo.com.au', true, 'https://www.speedo.com.au/products.json?limit=250', null),
  ('zoggs', 'Zoggs', 'https://www.zoggs.com/en_AU', true, 'https://www.zoggs.com/en_AU/products.json?limit=250', 'Use /en_AU locale path.'),
  ('maaji', 'Maaji', 'https://www.maaji.co', true, 'https://www.maaji.co/products.json?limit=250', 'Global .co domain.'),
  ('pq swim', 'PQ Swim', 'https://pqswim.com', true, 'https://pqswim.com/products.json?limit=250', null),
  ('nip tuck swim', 'Nip Tuck Swim', 'https://niptuckswim.com.au', true, 'https://niptuckswim.com.au/products.json?limit=250', 'Use .com.au.'),
  ('bouton bleu', 'Bouton Bleu', null, false, null, 'No global site — sold via retailers only. Use markup fallback.'),
  ('fantasie', 'Fantasie', null, false, null, 'Wacoal Europe brand. No direct AU site. Use markup fallback.'),
  ('freya', 'Freya', null, false, null, 'Wacoal Europe brand. No direct AU site. Use markup fallback.'),
  ('wacoal', 'Wacoal', null, false, null, 'No direct AU consumer site. Use markup fallback.')
on conflict (brand_name_normalised) do nothing;
