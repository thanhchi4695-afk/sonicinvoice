-- Processing history for the URL Product Extractor (and any future
-- extraction agents). Insert-once, read-many; users see their own rows.
CREATE TABLE IF NOT EXISTS public.processing_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL,
  source TEXT NOT NULL DEFAULT 'product-extract',
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  product_name TEXT NULL,
  error_message TEXT NULL,
  images_count INTEGER NOT NULL DEFAULT 0,
  extraction_strategy TEXT NULL CHECK (extraction_strategy IN ('jsonld', 'selectors', 'llm') OR extraction_strategy IS NULL),
  processing_time_ms INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processing_history_user_created
  ON public.processing_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_history_status
  ON public.processing_history (status, created_at DESC);

ALTER TABLE public.processing_history ENABLE ROW LEVEL SECURITY;

-- Users see only their own rows; admins see everything.
CREATE POLICY "Users can view their own processing history"
  ON public.processing_history
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Users can insert rows tagged with their own uid; service role bypasses RLS.
CREATE POLICY "Users can insert their own processing history"
  ON public.processing_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);