-- Supplier Skills File: per-user, per-supplier extraction knowledge that
-- gets injected into the Claude system prompt at extraction time.
CREATE TABLE IF NOT EXISTS public.supplier_skills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  skills_markdown text NOT NULL DEFAULT '',
  auto_generated_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  invoice_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_skills_user_supplier_unique UNIQUE (user_id, supplier_name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_skills_user_supplier
  ON public.supplier_skills (user_id, lower(supplier_name));

ALTER TABLE public.supplier_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own supplier skills"
  ON public.supplier_skills FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own supplier skills"
  ON public.supplier_skills FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own supplier skills"
  ON public.supplier_skills FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own supplier skills"
  ON public.supplier_skills FOR DELETE
  USING (auth.uid() = user_id);

-- Reuse existing updated_at trigger function on the last_updated_at column.
CREATE OR REPLACE FUNCTION public.touch_supplier_skills_updated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_skills_touch ON public.supplier_skills;
CREATE TRIGGER trg_supplier_skills_touch
  BEFORE UPDATE ON public.supplier_skills
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_supplier_skills_updated();