ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS restock_period_days integer DEFAULT 28,
  ADD COLUMN IF NOT EXISTS default_restock_status text DEFAULT 'ongoing' CHECK (default_restock_status IN ('ongoing','refill','no_reorder')),
  ADD COLUMN IF NOT EXISTS supplier_email text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS portal_url text;