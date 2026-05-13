ALTER TABLE public.collection_blog_plans
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;