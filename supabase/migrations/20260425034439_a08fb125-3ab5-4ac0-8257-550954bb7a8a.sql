-- Remove any prior schedule so re-running is idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('scan-gmail-inboxes');
EXCEPTION WHEN OTHERS THEN
  -- ignore "job not found"
  NULL;
END $$;

SELECT cron.schedule(
  'scan-gmail-inboxes',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/scan-gmail-inbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54'
    ),
    body := jsonb_build_object('scan_all_users', true)
  ) WHERE EXISTS (SELECT 1 FROM public.gmail_connections WHERE is_active = true);
  $cron$
);