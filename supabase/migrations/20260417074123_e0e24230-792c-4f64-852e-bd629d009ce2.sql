-- Daily anonymised pattern aggregation
SELECT cron.schedule(
  'aggregate-shared-patterns-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/aggregate-patterns',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);