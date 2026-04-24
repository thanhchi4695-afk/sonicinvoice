-- ───────────────────────────────────────────────────────────
-- 1. Per-user settings (provider + cap)
-- ───────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  search_provider text not null default 'anthropic'
    check (search_provider in ('anthropic', 'brave')),
  monthly_websearch_cap int not null default 500
    check (monthly_websearch_cap >= 0 and monthly_websearch_cap <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users read own settings"
  on public.user_settings for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own settings"
  on public.user_settings for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own settings"
  on public.user_settings for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.update_updated_at_column();

-- ───────────────────────────────────────────────────────────
-- 2. Shared search-results cache (deduplication, not personal)
-- ───────────────────────────────────────────────────────────
create table if not exists public.search_results_cache (
  cache_key text primary key,
  matched_url text,
  price numeric(10,2),
  image_url text,
  description text,
  raw_snippet text,
  source text not null,
  cost_aud numeric(10,4) not null default 0,
  found boolean not null,
  query_used text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hit_count int not null default 0
);

create index if not exists search_results_cache_expires_at_idx
  on public.search_results_cache (expires_at);

alter table public.search_results_cache enable row level security;

create policy "Authenticated read cache"
  on public.search_results_cache for select to authenticated
  using (true);

create policy "Authenticated write cache"
  on public.search_results_cache for insert to authenticated
  with check (true);

create policy "Authenticated update cache"
  on public.search_results_cache for update to authenticated
  using (true) with check (true);

-- ───────────────────────────────────────────────────────────
-- 3. Per-user usage log (for cap + dashboard)
-- ───────────────────────────────────────────────────────────
create table if not exists public.websearch_usage_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  source text not null,
  matched_url text,
  cost_aud numeric(10,4) not null default 0,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists websearch_usage_log_user_created_idx
  on public.websearch_usage_log (user_id, created_at desc);

alter table public.websearch_usage_log enable row level security;

create policy "Users read own usage"
  on public.websearch_usage_log for select to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own usage"
  on public.websearch_usage_log for insert to authenticated
  with check (auth.uid() = user_id);