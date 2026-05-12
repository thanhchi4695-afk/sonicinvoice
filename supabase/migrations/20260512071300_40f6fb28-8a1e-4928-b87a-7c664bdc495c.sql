-- Outlook connections
CREATE TABLE public.outlook_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email_address TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_checked_at TIMESTAMPTZ,
  last_email_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outlook_connections_user_email_uniq UNIQUE (user_id, email_address)
);
ALTER TABLE public.outlook_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own outlook connection" ON public.outlook_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own outlook connection" ON public.outlook_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own outlook connection" ON public.outlook_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own outlook connection" ON public.outlook_connections FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_outlook_connections_updated_at BEFORE UPDATE ON public.outlook_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- IMAP connections (Yahoo, iCloud, custom)
CREATE TABLE public.imap_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email_address TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INT NOT NULL DEFAULT 993,
  imap_tls BOOLEAN NOT NULL DEFAULT true,
  imap_username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  provider_label TEXT NOT NULL DEFAULT 'yahoo',
  last_checked_at TIMESTAMPTZ,
  last_uid BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT imap_connections_user_email_uniq UNIQUE (user_id, email_address)
);
ALTER TABLE public.imap_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own imap connection" ON public.imap_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own imap connection" ON public.imap_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own imap connection" ON public.imap_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own imap connection" ON public.imap_connections FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_imap_connections_updated_at BEFORE UPDATE ON public.imap_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend gmail_found_invoices to support all providers
ALTER TABLE public.gmail_found_invoices
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'gmail',
  ADD COLUMN IF NOT EXISTS connection_id UUID;