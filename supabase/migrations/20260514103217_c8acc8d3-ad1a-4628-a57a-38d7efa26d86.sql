-- Reset matching Drive files back to "pending" so the drive-worker re-submits them
UPDATE public.drive_ingested_files d
SET status = 'pending', parse_job_id = NULL, error = NULL
WHERE d.id IN (
  SELECT DISTINCT d2.id
  FROM public.drive_ingested_files d2
  JOIN public.invoice_processing_jobs j
    ON j.file_name = d2.drive_file_name
   AND j.user_id  = d2.user_id
  WHERE j.status = 'failed'
    AND j.error_message LIKE '%504%'
    AND j.created_at > now() - interval '7 days'
);