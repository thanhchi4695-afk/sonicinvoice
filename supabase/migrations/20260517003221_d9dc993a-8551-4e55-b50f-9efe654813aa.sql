
-- Phase 3: SEO A/B Tester (Karpathy Loop)

create table if not exists public.seo_ab_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  collection_id text not null,
  collection_handle text not null,
  collection_title text,
  collection_url text,
  variant_id text not null,
  is_control boolean not null default false,
  seo_title text,
  meta_description text,
  h1_tag text,
  start_date date,
  end_date date,
  impressions integer not null default 0,
  clicks integer not null default 0,
  ctr float not null default 0,
  position float,
  is_winner boolean not null default false,
  status text not null default 'pending',
  parent_experiment_group uuid,
  ai_rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seo_ab_experiments_user_idx on public.seo_ab_experiments(user_id, created_at desc);
create index if not exists seo_ab_experiments_group_idx on public.seo_ab_experiments(parent_experiment_group);
create index if not exists seo_ab_experiments_collection_idx on public.seo_ab_experiments(user_id, collection_id);

alter table public.seo_ab_experiments enable row level security;

create policy "users select own seo_ab_experiments"
on public.seo_ab_experiments for select
to authenticated using (auth.uid() = user_id);
create policy "users insert own seo_ab_experiments"
on public.seo_ab_experiments for insert
to authenticated with check (auth.uid() = user_id);
create policy "users update own seo_ab_experiments"
on public.seo_ab_experiments for update
to authenticated using (auth.uid() = user_id);
create policy "users delete own seo_ab_experiments"
on public.seo_ab_experiments for delete
to authenticated using (auth.uid() = user_id);

create trigger trg_seo_ab_experiments_updated_at
before update on public.seo_ab_experiments
for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------

create table if not exists public.seo_ab_experiment_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  run_started_at timestamptz not null default now(),
  run_completed_at timestamptz,
  phase text not null,
  experiments_ran integer not null default 0,
  winners_promoted integer not null default 0,
  ctr_improvement_pct float,
  error_message text,
  details jsonb
);

create index if not exists seo_ab_experiment_log_user_idx on public.seo_ab_experiment_log(user_id, run_started_at desc);

alter table public.seo_ab_experiment_log enable row level security;

create policy "users select own seo_ab_experiment_log"
on public.seo_ab_experiment_log for select
to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------

create table if not exists public.seo_ab_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  experiment_id uuid not null references public.seo_ab_experiments(id) on delete cascade,
  parent_experiment_group uuid not null,
  collection_id text not null,
  collection_handle text not null,
  variant_id text not null,
  scheduled_start_date date not null,
  scheduled_end_date date not null,
  status text not null default 'pending',
  previous_seo_title text,
  previous_meta_description text,
  previous_h1_tag text,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seo_ab_schedule_user_idx on public.seo_ab_schedule(user_id, status, scheduled_start_date);
create index if not exists seo_ab_schedule_group_idx on public.seo_ab_schedule(parent_experiment_group);

alter table public.seo_ab_schedule enable row level security;

create policy "users select own seo_ab_schedule"
on public.seo_ab_schedule for select
to authenticated using (auth.uid() = user_id);
create policy "users insert own seo_ab_schedule"
on public.seo_ab_schedule for insert
to authenticated with check (auth.uid() = user_id);
create policy "users update own seo_ab_schedule"
on public.seo_ab_schedule for update
to authenticated using (auth.uid() = user_id);
create policy "users delete own seo_ab_schedule"
on public.seo_ab_schedule for delete
to authenticated using (auth.uid() = user_id);

create trigger trg_seo_ab_schedule_updated_at
before update on public.seo_ab_schedule
for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------

create table if not exists public.seo_ab_settings (
  user_id uuid primary key,
  enabled boolean not null default false,
  auto_promote boolean not null default true,
  min_impressions integer not null default 100,
  min_ctr_lift float not null default 0.10,
  max_concurrent integer not null default 3,
  test_window_days integer not null default 7,
  manual_approval_lift float not null default 0.25,
  excluded_collections text[] not null default '{}'::text[],
  gsc_site_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seo_ab_settings enable row level security;

create policy "users select own seo_ab_settings"
on public.seo_ab_settings for select
to authenticated using (auth.uid() = user_id);
create policy "users upsert own seo_ab_settings"
on public.seo_ab_settings for insert
to authenticated with check (auth.uid() = user_id);
create policy "users update own seo_ab_settings"
on public.seo_ab_settings for update
to authenticated using (auth.uid() = user_id);

create trigger trg_seo_ab_settings_updated_at
before update on public.seo_ab_settings
for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------

create table if not exists public.seo_ab_gsc_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  experiment_id uuid not null references public.seo_ab_experiments(id) on delete cascade,
  variant_id text not null,
  metric_date date not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  ctr float not null default 0,
  position float,
  created_at timestamptz not null default now(),
  unique (experiment_id, metric_date)
);

create index if not exists seo_ab_gsc_daily_user_idx on public.seo_ab_gsc_daily(user_id, metric_date desc);
create index if not exists seo_ab_gsc_daily_exp_idx on public.seo_ab_gsc_daily(experiment_id, metric_date);

alter table public.seo_ab_gsc_daily enable row level security;

create policy "users select own seo_ab_gsc_daily"
on public.seo_ab_gsc_daily for select
to authenticated using (auth.uid() = user_id);
