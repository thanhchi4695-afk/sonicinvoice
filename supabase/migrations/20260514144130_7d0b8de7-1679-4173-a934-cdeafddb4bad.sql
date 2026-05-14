-- Wire two orphan SEO/GEO crons.
-- 1) seo-quarterly-refresh: 02:00 UTC on the 1st of every 3rd month
-- 2) collection-intelligence-cron: 01:00 UTC daily
SELECT cron.schedule(
  'seo-quarterly-refresh',
  '0 2 1 */3 *',
  $$
  select net.http_post(
    url:='https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/seo-quarterly-refresh',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54"}'::jsonb,
    body:='{"source":"cron"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'collection-intelligence-nightly',
  '0 1 * * *',
  $$
  select net.http_post(
    url:='https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/collection-intelligence-cron',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54"}'::jsonb,
    body:='{"source":"cron"}'::jsonb
  );
  $$
);