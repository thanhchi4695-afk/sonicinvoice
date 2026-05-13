
create table if not exists public.klaviyo_event_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_name text not null,
  profile_email text,
  payload jsonb not null,
  status text not null default 'pending',
  http_status int,
  response_body text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.klaviyo_event_log enable row level security;
create policy "users read own klaviyo events"
  on public.klaviyo_event_log for select
  using (auth.uid() = user_id);
create policy "service role manages klaviyo events"
  on public.klaviyo_event_log for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
create index if not exists klaviyo_event_log_user_created_idx
  on public.klaviyo_event_log (user_id, created_at desc);
