CREATE TABLE public.inventory_import_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  run_status TEXT NOT NULL DEFAULT 'started',
  source TEXT NOT NULL DEFAULT 'stock_check_refill',
  invoice_id TEXT,
  supplier_name TEXT,
  location_id TEXT,
  location_name TEXT,
  group_key TEXT,
  style_number TEXT,
  colour TEXT,
  product_title TEXT,
  shopify_product_id TEXT,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  after_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  units_applied INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inventory_import_runs_idem_uniq
  ON public.inventory_import_runs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX inventory_import_runs_user_started_idx
  ON public.inventory_import_runs (user_id, started_at DESC);

CREATE INDEX inventory_import_runs_invoice_idx
  ON public.inventory_import_runs (user_id, invoice_id);

ALTER TABLE public.inventory_import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own inventory import runs"
  ON public.inventory_import_runs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);