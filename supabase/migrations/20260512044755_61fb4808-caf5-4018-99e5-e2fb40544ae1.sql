ALTER TABLE public.drive_ingested_files
ADD COLUMN IF NOT EXISTS folder_id text;

UPDATE public.drive_ingested_files dif
SET folder_id = dws.folder_id
FROM public.drive_watch_settings dws
WHERE dif.user_id = dws.user_id
  AND dif.folder_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_drive_ingested_user_folder
ON public.drive_ingested_files(user_id, folder_id, ingested_at DESC);