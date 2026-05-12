-- Phase 3: Track silent training pipeline processing on email-discovered invoices
ALTER TABLE public.gmail_found_invoices
  ADD COLUMN IF NOT EXISTS silent_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS silent_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silent_last_error text,
  ADD COLUMN IF NOT EXISTS silent_status text;

CREATE INDEX IF NOT EXISTS idx_gmail_found_invoices_silent_pending
  ON public.gmail_found_invoices (received_at DESC)
  WHERE silent_processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gmail_found_invoices_user_connection_silent
  ON public.gmail_found_invoices (user_id, connection_id, silent_processed_at);
