ALTER TABLE public.brand_intelligence
  ADD COLUMN IF NOT EXISTS davidjones_reference jsonb,
  ADD COLUMN IF NOT EXISTS louenhide_megantic_reference jsonb;