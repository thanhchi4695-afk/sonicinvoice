ALTER TABLE public.drive_watch_settings DROP CONSTRAINT IF EXISTS drive_watch_settings_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS drive_watch_settings_user_folder_uniq ON public.drive_watch_settings(user_id, folder_id);
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;