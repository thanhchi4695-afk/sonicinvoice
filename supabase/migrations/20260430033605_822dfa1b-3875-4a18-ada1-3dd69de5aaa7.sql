-- Bulk discount schedules — used by the Google Shopping bulk scheduler.
-- Each row stores everything needed to revert prices automatically once
-- the sale ends, plus a snapshot of the filter that produced it.

CREATE TABLE IF NOT EXISTS public.bulk_discount_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','reverted','cancelled','failed')),
  strategy text NOT NULL
    CHECK (strategy IN ('percentage','fixed_amount','match_competitor','clearance')),
  discount_value numeric,
  filter_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Array of { variantId, productId, originalPrice, newPrice, sku, title }
  variants_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_count int NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  applied_at timestamptz,
  reverted_at timestamptz,
  last_error text,
  use_google_auto_pricing boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bulk_discount_schedules_user_idx
  ON public.bulk_discount_schedules(user_id);
CREATE INDEX IF NOT EXISTS bulk_discount_schedules_status_idx
  ON public.bulk_discount_schedules(status, ends_at);

CREATE TRIGGER bulk_discount_schedules_set_updated_at
  BEFORE UPDATE ON public.bulk_discount_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bulk_discount_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their schedules"
  ON public.bulk_discount_schedules FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can insert their schedules"
  ON public.bulk_discount_schedules FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners can update their schedules"
  ON public.bulk_discount_schedules FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can delete their schedules"
  ON public.bulk_discount_schedules FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));