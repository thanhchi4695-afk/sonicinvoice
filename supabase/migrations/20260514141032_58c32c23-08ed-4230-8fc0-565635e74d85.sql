-- 1) Reschedule weekly cron from 22:00 UTC -> 23:00 UTC Sundays
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'seo-health-scan-weekly';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'seo-health-scan-weekly',
  '0 23 * * 0',
  $$
  select net.http_post(
    url:='https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/seo-health-scan',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54"}'::jsonb,
    body:='{"source":"cron"}'::jsonb
  ) as request_id;
  $$
);

-- 2) Auto-resolve trigger: when a suggestion is re-approved/re-published,
--    refresh its baseline snapshot and resolve open alerts that no longer apply.
CREATE OR REPLACE FUNCTION public.refresh_seo_health_on_resync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link_count int := 0;
  v_body text;
BEGIN
  -- Only fire on re-approval or re-publish transitions
  IF NOT (
    (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved') OR
    (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published')
  ) THEN
    RETURN NEW;
  END IF;

  -- Refresh snapshot baseline to "what Sonic wrote now"
  -- (snapshot trigger only fires on first approval; re-approvals must overwrite)
  IF NEW.status = 'approved' THEN
    DELETE FROM public.collection_seo_snapshots WHERE suggestion_id = NEW.id;
    INSERT INTO public.collection_seo_snapshots (
      user_id, suggestion_id, shopify_collection_id,
      snapshot_title, snapshot_meta_description, snapshot_body_html,
      snapshot_completeness_score
    )
    SELECT
      NEW.user_id, NEW.id, NEW.shopify_collection_id,
      COALESCE(o.seo_title, NEW.suggested_title),
      COALESCE(o.meta_description, NEW.seo_description),
      COALESCE(NEW.description_html, ''),
      NEW.completeness_score
    FROM public.collection_seo_outputs o
    WHERE o.suggestion_id = NEW.id
    LIMIT 1;
  END IF;

  -- Cheap auto-resolve for the rules we can evaluate from DB state alone.
  -- (thin_collection / content_drift need live Shopify; weekly cron handles those.)

  -- completeness_drop: resolve if score back >= 60
  IF (NEW.completeness_score IS NOT NULL AND NEW.completeness_score >= 60) THEN
    UPDATE public.seo_health_alerts
       SET resolved_at = now()
     WHERE suggestion_id = NEW.id
       AND alert_type = 'completeness_drop'
       AND resolved_at IS NULL;
  END IF;

  -- no_internal_links: count links in current body_html
  v_body := COALESCE(NEW.description_html, '');
  SELECT COALESCE(array_length(regexp_matches(v_body, '<a\s[^>]*href=', 'gi'), 1), 0)
    INTO v_link_count;
  IF v_link_count > 0 THEN
    UPDATE public.seo_health_alerts
       SET resolved_at = now()
     WHERE suggestion_id = NEW.id
       AND alert_type = 'no_internal_links'
       AND resolved_at IS NULL;
  END IF;

  -- Kick off a targeted re-scan asynchronously to refresh thin/drift alerts too
  BEGIN
    PERFORM net.http_post(
      url := 'https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/seo-health-scan',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFrZ2Rra3Jyc3F4YWZmZnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTg1MDAsImV4cCI6MjA5MDU3NDUwMH0.6DzvVtghNcDJUYbx7BcecoQw7lBGUZ6p_-dXv7eLh54"}'::jsonb,
      body := jsonb_build_object('user_id', NEW.user_id, 'suggestion_id', NEW.id, 'source', 'trigger')
    );
  EXCEPTION WHEN OTHERS THEN
    -- Don't block the user write if net call fails; weekly cron will catch it.
    NULL;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_seo_health_on_resync ON public.collection_suggestions;
CREATE TRIGGER trg_refresh_seo_health_on_resync
AFTER UPDATE OF status ON public.collection_suggestions
FOR EACH ROW
EXECUTE FUNCTION public.refresh_seo_health_on_resync();
