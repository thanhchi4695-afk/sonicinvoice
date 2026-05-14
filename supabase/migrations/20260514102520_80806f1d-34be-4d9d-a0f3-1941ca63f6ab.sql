UPDATE public.gmail_found_invoices
SET silent_processed_at = NULL,
    silent_status = NULL,
    silent_last_error = NULL,
    silent_attempt_count = 0
WHERE silent_status = 'error'
  AND silent_last_error LIKE '%Unexpected close%'
  AND created_at > now() - interval '14 days';

DELETE FROM public.gmail_found_invoices
WHERE provider = 'gmail'
  AND connection_id IS NULL
  AND silent_last_error LIKE '%unauthorized_client%';