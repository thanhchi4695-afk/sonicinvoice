-- Extensions for scheduled polling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Gmail OAuth connections (one per user)
CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email_address text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_checked_at timestamptz,
  last_email_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gmail connection"
  ON public.gmail_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own gmail connection"
  ON public.gmail_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own gmail connection"
  ON public.gmail_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own gmail connection"
  ON public.gmail_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_gmail_connections_updated_at
  BEFORE UPDATE ON public.gmail_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Found invoices from inbox scans
CREATE TABLE IF NOT EXISTS public.gmail_found_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_id text NOT NULL,
  from_email text,
  subject text,
  received_at timestamptz,
  supplier_name text,
  known_supplier boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

ALTER TABLE public.gmail_found_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own found invoices"
  ON public.gmail_found_invoices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own found invoices"
  ON public.gmail_found_invoices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own found invoices"
  ON public.gmail_found_invoices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own found invoices"
  ON public.gmail_found_invoices FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_gmail_found_invoices_user_received
  ON public.gmail_found_invoices (user_id, received_at DESC);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.gmail_found_invoices;
ALTER TABLE public.gmail_found_invoices REPLICA IDENTITY FULL;