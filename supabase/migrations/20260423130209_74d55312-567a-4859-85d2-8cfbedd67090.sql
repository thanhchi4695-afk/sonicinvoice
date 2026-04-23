-- Add status tracking + scheduling support for processing_queue and pattern stubs
ALTER TABLE public.processing_queue
  ADD COLUMN IF NOT EXISTS pattern_id uuid,
  ADD COLUMN IF NOT EXISTS file_size_bytes integer,
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Allow 'pending_review' as a valid pattern marker — patterns table has no
-- enum, so just add a discoverable column for the worker.
ALTER TABLE public.invoice_patterns
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'reviewed';

-- Index for the worker: claim oldest queued items quickly
CREATE INDEX IF NOT EXISTS idx_processing_queue_status_created
  ON public.processing_queue (status, created_at);

-- Service-role insert/update is allowed without RLS, but we also want
-- the worker (which acts as the user) to be able to insert pattern rows.
-- Existing policies already cover that.
