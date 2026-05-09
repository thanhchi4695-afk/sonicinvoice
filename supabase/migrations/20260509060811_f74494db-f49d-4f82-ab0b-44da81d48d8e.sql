-- Add profile_status to brand_profiles
ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS profile_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.brand_profiles
  DROP CONSTRAINT IF EXISTS brand_profiles_profile_status_check;

ALTER TABLE public.brand_profiles
  ADD CONSTRAINT brand_profiles_profile_status_check
  CHECK (profile_status IN ('active','needs_enrichment','do_not_book'));

CREATE INDEX IF NOT EXISTS idx_brand_profiles_profile_status
  ON public.brand_profiles (profile_status);