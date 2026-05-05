CREATE TABLE IF NOT EXISTS public.collection_memory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  collection_title text NOT NULL,
  collection_handle text NOT NULL,
  shopify_collection_id text,
  level text NOT NULL,
  source_invoice text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, shop_domain, collection_handle)
);

ALTER TABLE public.collection_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own collection memory" ON public.collection_memory
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own collection memory" ON public.collection_memory
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own collection memory" ON public.collection_memory
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own collection memory" ON public.collection_memory
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_collection_memory_user_shop ON public.collection_memory(user_id, shop_domain);