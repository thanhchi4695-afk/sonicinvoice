-- ─────────────────────────────────────────────────────────────────────
-- Phase 1: Silent Invoice Training Pipeline — Schema Foundation
-- ─────────────────────────────────────────────────────────────────────

-- 1. training_parses: archive of every silent parse
CREATE TABLE public.training_parses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  mailbox_provider    text NOT NULL CHECK (mailbox_provider IN ('gmail','imap','outlook')),
  mailbox_connection_id uuid,
  email_account       text NOT NULL,
  sender_domain       text,
  email_message_id    text NOT NULL,
  attachment_filename text NOT NULL,
  attachment_sha256   text NOT NULL,
  attachment_mime     text,
  attachment_bytes    integer,
  brand_detected      text,
  invoice_date        date,
  document_type       text,
  products_extracted  jsonb NOT NULL DEFAULT '[]'::jsonb,
  parse_confidence    numeric NOT NULL DEFAULT 0,
  fields_detected     jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_text            text,
  raw_text_purged_at  timestamptz,
  parse_status        text NOT NULL DEFAULT 'success' CHECK (parse_status IN ('success','low_confidence','failed','skipped')),
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX training_parses_dedup_idx
  ON public.training_parses (email_message_id, attachment_filename, attachment_sha256);
CREATE INDEX training_parses_user_idx ON public.training_parses (user_id, created_at DESC);
CREATE INDEX training_parses_brand_idx ON public.training_parses (brand_detected, created_at DESC);
CREATE INDEX training_parses_mailbox_idx ON public.training_parses (mailbox_connection_id, created_at DESC);

ALTER TABLE public.training_parses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read training parses"
  ON public.training_parses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role writes training parses"
  ON public.training_parses FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update training parses"
  ON public.training_parses FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete training parses"
  ON public.training_parses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. training_logs: event log
CREATE TABLE public.training_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,
  mailbox_connection_id uuid,
  event_type      text NOT NULL,
  brand_name      text,
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error')),
  message         text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX training_logs_recent_idx ON public.training_logs (created_at DESC);
CREATE INDEX training_logs_event_idx ON public.training_logs (event_type, created_at DESC);

ALTER TABLE public.training_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read training logs"
  ON public.training_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write training logs"
  ON public.training_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Extend brand_patterns
ALTER TABLE public.brand_patterns
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS column_map      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS header_row      integer,
  ADD COLUMN IF NOT EXISTS is_global       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avg_confidence  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_streak   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_until    timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at    timestamptz,
  ADD COLUMN IF NOT EXISTS sender_domains  text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS brand_patterns_global_idx
  ON public.brand_patterns (is_global) WHERE is_global = true;
CREATE INDEX IF NOT EXISTS brand_patterns_brand_idx
  ON public.brand_patterns (lower(brand_name));

-- Allow authenticated users to read global patterns (per-user RLS already exists for their own rows)
DROP POLICY IF EXISTS "Authenticated read global brand patterns" ON public.brand_patterns;
CREATE POLICY "Authenticated read global brand patterns"
  ON public.brand_patterns FOR SELECT TO authenticated
  USING (is_global = true);

DROP POLICY IF EXISTS "Admins manage global brand patterns" ON public.brand_patterns;
CREATE POLICY "Admins manage global brand patterns"
  ON public.brand_patterns FOR ALL TO authenticated
  USING (is_global = true AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (is_global = true AND public.has_role(auth.uid(), 'admin'));

-- 4. Extend app_settings (singleton)
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS training_pipeline_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS brand_context_injection_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_silent_parse_cap           integer NOT NULL DEFAULT 500;

-- 5. Extend mailbox connections with per-mailbox training control
ALTER TABLE public.gmail_connections
  ADD COLUMN IF NOT EXISTS training_pipeline_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS historical_sweep_status      text NOT NULL DEFAULT 'pending'
    CHECK (historical_sweep_status IN ('pending','running','complete','paused')),
  ADD COLUMN IF NOT EXISTS historical_sweep_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS historical_sweep_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS silent_parses_today          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silent_parses_today_date     date;

ALTER TABLE public.imap_connections
  ADD COLUMN IF NOT EXISTS training_pipeline_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS historical_sweep_status      text NOT NULL DEFAULT 'pending'
    CHECK (historical_sweep_status IN ('pending','running','complete','paused')),
  ADD COLUMN IF NOT EXISTS historical_sweep_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS historical_sweep_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS silent_parses_today          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silent_parses_today_date     date;

ALTER TABLE public.outlook_connections
  ADD COLUMN IF NOT EXISTS training_pipeline_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS historical_sweep_status      text NOT NULL DEFAULT 'pending'
    CHECK (historical_sweep_status IN ('pending','running','complete','paused')),
  ADD COLUMN IF NOT EXISTS historical_sweep_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS historical_sweep_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS silent_parses_today          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silent_parses_today_date     date;

-- 6. Auto-purge raw_text older than 12 months (function callable from cron)
CREATE OR REPLACE FUNCTION public.purge_old_training_raw_text()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.training_parses
     SET raw_text = NULL,
         raw_text_purged_at = now()
   WHERE raw_text IS NOT NULL
     AND raw_text_purged_at IS NULL
     AND created_at < now() - interval '12 months';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 7. Pre-seed global brand patterns for AU swimwear/fashion brands
INSERT INTO public.brand_patterns
  (user_id, brand_name, is_global, sample_count, accuracy_rate, avg_confidence,
   sender_domains, special_rules, last_seen_at)
VALUES
  (NULL, 'Seafolly',       true, 0, 1.0, 0, ARRAY['seafolly.com','seafolly.com.au']::text[], '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Bond-Eye',       true, 0, 1.0, 0, ARRAY['bondeye.com','bondeyeswim.com']::text[],   '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Rhythm',         true, 0, 1.0, 0, ARRAY['rhythm.com','rhythmlivin.com']::text[],    '{"category":"surf","country":"AU"}'::jsonb, now()),
  (NULL, 'Baku',           true, 0, 1.0, 0, ARRAY['baku.com.au']::text[],                     '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Jantzen',        true, 0, 1.0, 0, ARRAY['jantzen.com','jantzen.com.au']::text[],    '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Sunseeker',      true, 0, 1.0, 0, ARRAY['sunseeker.com.au']::text[],                '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Sea Level',      true, 0, 1.0, 0, ARRAY['sealevel.com.au']::text[],                 '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Funkita',        true, 0, 1.0, 0, ARRAY['funkita.com','funkita.com.au']::text[],    '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Funky Trunks',   true, 0, 1.0, 0, ARRAY['funkytrunks.com','funkytrunks.com.au']::text[], '{"category":"swimwear","country":"AU"}'::jsonb, now()),
  (NULL, 'Alemais',        true, 0, 1.0, 0, ARRAY['alemais.com','alemais.com.au']::text[],    '{"category":"fashion","country":"AU"}'::jsonb, now()),
  (NULL, 'Artesands',      true, 0, 1.0, 0, ARRAY['artesands.com','artesands.com.au']::text[],'{"category":"swimwear","country":"AU"}'::jsonb, now())
ON CONFLICT DO NOTHING;
