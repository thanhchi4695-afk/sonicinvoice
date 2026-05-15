CREATE TABLE IF NOT EXISTS public.llms_txt_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  shop_domain TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT llms_txt_files_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_llms_txt_files_shop_domain ON public.llms_txt_files (lower(shop_domain));

ALTER TABLE public.llms_txt_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own llms.txt"
  ON public.llms_txt_files
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());