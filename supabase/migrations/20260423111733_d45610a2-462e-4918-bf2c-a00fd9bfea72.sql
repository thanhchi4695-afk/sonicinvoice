
-- Processing queue for server-side Drive batch ingestion
CREATE TABLE public.processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'drive',           -- 'drive' | 'upload' | 'shopify'
  source_url text,                                -- drive folder url
  drive_file_id text,                             -- drive file id, for retry/dedupe
  file_name text NOT NULL,
  file_type text,                                 -- pdf | jpg | png | webp
  status text NOT NULL DEFAULT 'queued',          -- queued | processing | done | failed | cancelled
  error text,
  upload_id uuid,                                 -- references invoice_uploads once created
  batch_id uuid,                                  -- groups items from same Auto-process all action
  position int NOT NULL DEFAULT 0,                -- ordering within a batch
  attempts int NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_processing_queue_user_status ON public.processing_queue(user_id, status);
CREATE INDEX idx_processing_queue_batch ON public.processing_queue(batch_id, position);
CREATE INDEX idx_processing_queue_drive_file ON public.processing_queue(user_id, drive_file_id) WHERE drive_file_id IS NOT NULL;

ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own queue items"
  ON public.processing_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users create their own queue items"
  ON public.processing_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own queue items"
  ON public.processing_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own queue items"
  ON public.processing_queue FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_processing_queue_updated_at
  BEFORE UPDATE ON public.processing_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for the dashboard subscription
ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_queue;
ALTER TABLE public.processing_queue REPLICA IDENTITY FULL;
