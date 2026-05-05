CREATE TABLE IF NOT EXISTS public.ai_model_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  notes TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read overrides"
  ON public.ai_model_overrides FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert overrides"
  ON public.ai_model_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update overrides"
  ON public.ai_model_overrides FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete overrides"
  ON public.ai_model_overrides FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_model_overrides_updated_at
  BEFORE UPDATE ON public.ai_model_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();