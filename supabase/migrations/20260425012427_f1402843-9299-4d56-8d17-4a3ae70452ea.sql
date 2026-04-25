
-- ============================================================
-- 1. agent_runs table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trigger_type text NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('email','manual','scheduled')),
  supplier_name text,
  supplier_profile_id uuid REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  invoice_filename text,
  products_extracted integer NOT NULL DEFAULT 0,
  products_auto_approved integer NOT NULL DEFAULT 0,
  products_flagged integer NOT NULL DEFAULT 0,
  auto_published boolean NOT NULL DEFAULT false,
  human_review_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','awaiting_review','published','failed')),
  invoice_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON public.agent_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_supplier ON public.agent_runs(supplier_profile_id);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own agent runs"
  ON public.agent_runs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. supplier_profiles new columns
-- ============================================================
ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS correction_rate numeric DEFAULT 0
    CHECK (correction_rate >= 0 AND correction_rate <= 1),
  ADD COLUMN IF NOT EXISTS email_domains text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_invoice_date timestamptz,
  ADD COLUMN IF NOT EXISTS auto_publish_eligible boolean DEFAULT false;

-- Tighten confidence_score range (existing column is integer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_profiles_confidence_score_range'
  ) THEN
    ALTER TABLE public.supplier_profiles
      ADD CONSTRAINT supplier_profiles_confidence_score_range
      CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));
  END IF;
END $$;

-- ============================================================
-- 3. user_settings automation toggles
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_settings') THEN
    EXECUTE 'ALTER TABLE public.user_settings
      ADD COLUMN IF NOT EXISTS automation_email_monitoring boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS automation_auto_extract boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS automation_auto_publish boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS automation_min_confidence integer NOT NULL DEFAULT 90
        CHECK (automation_min_confidence BETWEEN 70 AND 99)';
  END IF;
END $$;

-- ============================================================
-- 4. Backfill confidence_score and correction_rate
-- ============================================================
UPDATE public.supplier_profiles sp
SET confidence_score = LEAST(95, GREATEST(0,
  COALESCE((
    SELECT COUNT(*)::int FROM public.invoice_patterns ip
    WHERE ip.supplier_profile_id = sp.id
  ), 0) * 10
))
WHERE sp.confidence_score IS NULL OR sp.confidence_score = 0;

UPDATE public.supplier_profiles sp
SET correction_rate = COALESCE((
  SELECT LEAST(1.0,
    COUNT(*)::numeric
    / NULLIF(
        (SELECT COUNT(*) FROM public.invoice_patterns ip2
          WHERE ip2.supplier_profile_id = sp.id) * 20,
        0)
  )
  FROM public.correction_log cl
  WHERE cl.supplier_profile_id = sp.id
), 0.5);

UPDATE public.supplier_profiles
SET auto_publish_eligible = (
  COALESCE(confidence_score,0) >= 90
  AND COALESCE(correction_rate,1) <= 0.05
);

-- ============================================================
-- 5. Trigger function to recompute on new pattern/correction
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_supplier_confidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_invoice_count int;
  v_correction_count int;
  v_total_fields int;
  v_confidence int;
  v_correction_rate numeric;
BEGIN
  v_profile_id := NEW.supplier_profile_id;
  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_invoice_count
  FROM public.invoice_patterns
  WHERE supplier_profile_id = v_profile_id;

  SELECT COUNT(*) INTO v_correction_count
  FROM public.correction_log
  WHERE supplier_profile_id = v_profile_id;

  v_total_fields := v_invoice_count * 20;
  v_confidence := LEAST(95, v_invoice_count * 10);
  v_correction_rate := CASE
    WHEN v_total_fields = 0 THEN 0.5
    ELSE LEAST(1.0, v_correction_count::numeric / v_total_fields)
  END;

  UPDATE public.supplier_profiles
  SET
    confidence_score = v_confidence,
    correction_rate = v_correction_rate,
    invoice_count = v_invoice_count,
    last_invoice_date = now(),
    auto_publish_eligible = (v_confidence >= 90 AND v_correction_rate <= 0.05),
    updated_at = now()
  WHERE id = v_profile_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_confidence_on_invoice ON public.invoice_patterns;
CREATE TRIGGER trigger_update_confidence_on_invoice
  AFTER INSERT ON public.invoice_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_supplier_confidence();

DROP TRIGGER IF EXISTS trigger_update_confidence_on_correction ON public.correction_log;
CREATE TRIGGER trigger_update_confidence_on_correction
  AFTER INSERT ON public.correction_log
  FOR EACH ROW
  EXECUTE FUNCTION public.update_supplier_confidence();
