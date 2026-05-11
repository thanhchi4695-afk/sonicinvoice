-- Allow multiple Gmail accounts per user
ALTER TABLE public.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS gmail_connections_user_email_uniq
  ON public.gmail_connections (user_id, email_address);