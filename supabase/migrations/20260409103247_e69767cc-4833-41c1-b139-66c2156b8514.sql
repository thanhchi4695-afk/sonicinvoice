
CREATE TABLE public.accounting_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  xero_tenant_id   TEXT,
  xero_tenant_name TEXT,
  myob_company_file_id   TEXT,
  myob_company_file_name TEXT,
  myob_company_file_uri  TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  account_mappings JSONB NOT NULL DEFAULT '{}',
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced      TIMESTAMPTZ,
  UNIQUE(user_id, platform)
);

CREATE TABLE public.accounting_push_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  invoice_id       TEXT NOT NULL,
  external_id      TEXT,
  external_url     TEXT,
  supplier_name    TEXT,
  invoice_date     TEXT,
  total_ex_gst     NUMERIC,
  gst_amount       NUMERIC,
  total_inc_gst    NUMERIC,
  category         TEXT,
  status           TEXT DEFAULT 'pushed',
  error_message    TEXT,
  pushed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_push_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own accounting connections"
  ON public.accounting_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own push history"
  ON public.accounting_push_history FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
