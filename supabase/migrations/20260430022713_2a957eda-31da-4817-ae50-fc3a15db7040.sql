
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-screenshots', 'support-screenshots', true, 10485760, array['image/png','image/jpeg','image/jpg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "Public read support screenshots"
on storage.objects for select
using (bucket_id = 'support-screenshots');

create policy "Anyone can upload support screenshots"
on storage.objects for insert
with check (bucket_id = 'support-screenshots');
