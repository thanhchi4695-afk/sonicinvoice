UPDATE public.gmail_found_invoices
SET silent_status = NULL,
    silent_attempt_count = 0,
    silent_last_error = NULL,
    silent_processed_at = NULL
WHERE silent_status = 'error'
  AND silent_last_error LIKE '%training_parses_parse_status_check%';