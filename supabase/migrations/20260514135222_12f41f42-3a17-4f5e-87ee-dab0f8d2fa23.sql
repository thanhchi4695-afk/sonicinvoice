-- Snapshot of Sonic-generated content captured at APPROVAL time (baseline for drift detection)
CREATE TABLE public.collection_seo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  suggestion_id uuid NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  shopify_collection_id text,
  snapshot_title text,
  snapshot_meta_description text,
  snapshot_body_html text,
  snapshot_completeness_score int,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suggestion_id)
);

ALTER TABLE public.collection_seo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own snapshots" ON public.collection_seo_snapshots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own snapshots" ON public.collection_seo_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages snapshots" ON public.collection_seo_snapshots
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX idx_seo_snapshots_user ON public.collection_seo_snapshots(user_id);
CREATE INDEX idx_seo_snapshots_suggestion ON public.collection_seo_snapshots(suggestion_id);

-- Health alerts
CREATE TYPE public.seo_alert_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.seo_alert_type AS ENUM (
  'thin_collection',
  'content_drift',
  'no_internal_links',
  'completeness_drop'
);

CREATE TABLE public.seo_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  suggestion_id uuid REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  shopify_collection_id text,
  collection_handle text,
  collection_title text,
  alert_type public.seo_alert_type NOT NULL,
  severity public.seo_alert_severity NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  scan_run_id uuid
);

ALTER TABLE public.seo_health_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own alerts" ON public.seo_health_alerts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own alerts" ON public.seo_health_alerts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role manages alerts" ON public.seo_health_alerts
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX idx_seo_alerts_user_open ON public.seo_health_alerts(user_id, detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_seo_alerts_suggestion ON public.seo_health_alerts(suggestion_id);
CREATE UNIQUE INDEX idx_seo_alerts_unique_open
  ON public.seo_health_alerts(user_id, suggestion_id, alert_type)
  WHERE resolved_at IS NULL;

-- Capture Sonic-authored content at approval time (NOT publish time, so baseline = what Sonic wrote)
CREATE OR REPLACE FUNCTION public.capture_seo_snapshot_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_meta text;
  v_body text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT o.seo_title, o.meta_description, COALESCE(NEW.description_html, '')
      INTO v_title, v_meta, v_body
    FROM public.collection_seo_outputs o
    WHERE o.suggestion_id = NEW.id
    LIMIT 1;

    INSERT INTO public.collection_seo_snapshots (
      user_id, suggestion_id, shopify_collection_id,
      snapshot_title, snapshot_meta_description, snapshot_body_html,
      snapshot_completeness_score
    ) VALUES (
      NEW.user_id, NEW.id, NEW.shopify_collection_id,
      COALESCE(v_title, NEW.suggested_title),
      COALESCE(v_meta, NEW.seo_description),
      COALESCE(v_body, NEW.description_html, ''),
      NEW.completeness_score
    )
    ON CONFLICT (suggestion_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_capture_seo_snapshot
  AFTER UPDATE OF status ON public.collection_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.capture_seo_snapshot_on_approval();
