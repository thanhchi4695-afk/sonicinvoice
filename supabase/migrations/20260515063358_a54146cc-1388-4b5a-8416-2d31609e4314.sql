ALTER TABLE public.llms_txt_files
  ADD COLUMN IF NOT EXISTS shop_aliases TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_llms_txt_files_aliases
  ON public.llms_txt_files USING GIN (shop_aliases);