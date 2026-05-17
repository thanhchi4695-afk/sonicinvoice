
-- 1. Prompt experiments
CREATE TABLE public.prompt_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_type text NOT NULL,
  variant_id text NOT NULL,
  prompt_template text NOT NULL,
  temperature double precision DEFAULT 0.7,
  few_shot_examples jsonb DEFAULT '[]'::jsonb,
  approval_rate double precision,
  sample_size integer DEFAULT 0,
  is_active boolean DEFAULT false,
  parent_variant_id text,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_type, variant_id)
);
CREATE INDEX idx_prompt_experiments_active ON public.prompt_experiments (experiment_type, is_active) WHERE is_active = true;

-- 2. Feedback
CREATE TABLE public.prompt_experiment_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid REFERENCES public.prompt_experiments(id) ON DELETE CASCADE,
  variant_id text NOT NULL,
  experiment_type text NOT NULL,
  suggestion_id uuid,
  user_id uuid,
  approved boolean,
  edited boolean DEFAULT false,
  time_to_approve_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pef_variant ON public.prompt_experiment_feedback (experiment_type, variant_id, created_at DESC);
CREATE INDEX idx_pef_suggestion ON public.prompt_experiment_feedback (suggestion_id);

-- 3. Optimizer run log
CREATE TABLE public.prompt_optimizer_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_type text NOT NULL DEFAULT 'collection_description',
  run_started_at timestamptz NOT NULL DEFAULT now(),
  run_completed_at timestamptz,
  experiments_ran integer DEFAULT 0,
  winning_variant_id text,
  previous_variant_id text,
  improvement_percentage double precision,
  promoted boolean DEFAULT false,
  notes jsonb,
  error_message text
);
CREATE INDEX idx_pol_started ON public.prompt_optimizer_log (run_started_at DESC);

-- 4. Held-constant test product set (weekly refresh)
CREATE TABLE public.test_product_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_week date NOT NULL,
  product_id text NOT NULL,
  position integer,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_week, product_id)
);
CREATE INDEX idx_tps_week ON public.test_product_set (set_week DESC);

-- 5. Tag collection_suggestions with variant id
ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS prompt_variant_id text,
  ADD COLUMN IF NOT EXISTS prompt_experiment_id uuid REFERENCES public.prompt_experiments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_test_variant boolean DEFAULT false;

-- 6. Enable RLS
ALTER TABLE public.prompt_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_experiment_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_optimizer_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_product_set ENABLE ROW LEVEL SECURITY;

-- Read for any authenticated user
CREATE POLICY "auth read experiments" ON public.prompt_experiments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read feedback" ON public.prompt_experiment_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read log" ON public.prompt_optimizer_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read test set" ON public.test_product_set FOR SELECT TO authenticated USING (true);

-- Admin write
CREATE POLICY "admin write experiments" ON public.prompt_experiments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin write log" ON public.prompt_optimizer_log FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin write test set" ON public.test_product_set FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin write feedback" ON public.prompt_experiment_feedback FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. updated_at trigger
CREATE TRIGGER trg_prompt_experiments_updated_at
  BEFORE UPDATE ON public.prompt_experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Auto-feedback trigger on collection_suggestions status changes
CREATE OR REPLACE FUNCTION public.record_prompt_variant_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp_id uuid;
BEGIN
  IF NEW.prompt_variant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected', 'published') THEN
    RETURN NEW;
  END IF;

  -- Resolve experiment id (allow being set explicitly or look up)
  v_exp_id := NEW.prompt_experiment_id;
  IF v_exp_id IS NULL THEN
    SELECT id INTO v_exp_id FROM public.prompt_experiments
     WHERE experiment_type = 'collection_description' AND variant_id = NEW.prompt_variant_id
     LIMIT 1;
  END IF;

  INSERT INTO public.prompt_experiment_feedback (
    experiment_id, variant_id, experiment_type, suggestion_id, user_id, approved, edited
  ) VALUES (
    v_exp_id,
    NEW.prompt_variant_id,
    'collection_description',
    NEW.id,
    NEW.user_id,
    NEW.status IN ('approved', 'published'),
    (OLD.suggested_title IS DISTINCT FROM NEW.suggested_title)
      OR (OLD.seo_description IS DISTINCT FROM NEW.seo_description)
      OR (OLD.description_html IS DISTINCT FROM NEW.description_html)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_record_prompt_variant_feedback
AFTER UPDATE ON public.collection_suggestions
FOR EACH ROW EXECUTE FUNCTION public.record_prompt_variant_feedback();

-- 9. Seed baseline v0 prompt (current hardcoded prompt in seo-collection-engine)
INSERT INTO public.prompt_experiments (
  experiment_type, variant_id, prompt_template, temperature, few_shot_examples, is_active, promoted_at, sample_size, approval_rate
) VALUES (
  'collection_description',
  'v0',
  'You are an expert SEO copywriter for an Australian fashion retailer. Generate a Shopify collection page with:
- SEO title: 50-60 characters, include primary keyword and locale ("Australia" or city) naturally.
- Meta description: 140-160 characters, action-oriented, mentions the collection and store.
- Body HTML: 250-400 words, sections: opening hook, key features, styling tips, local relevance, CTA. Use <h2>, <p>, <ul> where natural.
- FAQ: 3 questions with concise <h3>/<p> answers.

Return strict JSON: {"seo_title":"","meta_description":"","description_html":"","faq_html":""}',
  0.7,
  '[]'::jsonb,
  true,
  now(),
  0,
  null
);
