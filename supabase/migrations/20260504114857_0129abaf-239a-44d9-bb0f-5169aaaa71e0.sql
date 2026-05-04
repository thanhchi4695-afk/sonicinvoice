
-- Add packing_list_suppliers default list to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS packing_list_suppliers text[] NOT NULL DEFAULT ARRAY['Tigerlily', 'Smelly Balls', 'Sky Gazer']::text[];

-- Add markup multiplier hint per supplier (used when "skip" pairing)
ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS markup_multiplier numeric,
  ADD COLUMN IF NOT EXISTS sends_packing_list_only boolean NOT NULL DEFAULT false;
