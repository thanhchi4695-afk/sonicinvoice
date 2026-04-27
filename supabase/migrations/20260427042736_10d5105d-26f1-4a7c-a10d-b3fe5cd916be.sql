CREATE TABLE public.product_abc_grades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID,
  variant_id UUID,
  grade TEXT NOT NULL CHECK (grade IN ('A','B','C','U')),
  period_days INTEGER NOT NULL DEFAULT 365,
  revenue NUMERIC NOT NULL DEFAULT 0,
  units_sold INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_abc_grades_unique
  ON public.product_abc_grades (user_id, variant_id, period_days);

CREATE INDEX product_abc_grades_user_grade_idx
  ON public.product_abc_grades (user_id, grade);

ALTER TABLE public.product_abc_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own abc grades select"
ON public.product_abc_grades FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Own abc grades insert"
ON public.product_abc_grades FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own abc grades update"
ON public.product_abc_grades FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own abc grades delete"
ON public.product_abc_grades FOR DELETE
USING (auth.uid() = user_id);