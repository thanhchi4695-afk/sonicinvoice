ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS smart_collection_rules JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.collection_suggestions DROP CONSTRAINT IF EXISTS collection_suggestions_collection_type_check;
ALTER TABLE public.collection_suggestions ADD CONSTRAINT collection_suggestions_collection_type_check
  CHECK (collection_type IN ('brand','brand_category','type','niche','print','archive','dimension','brand_print'));

ALTER TABLE public.collection_blogs DROP CONSTRAINT IF EXISTS collection_blogs_blog_type_check;
ALTER TABLE public.collection_blogs ADD CONSTRAINT collection_blogs_blog_type_check
  CHECK (blog_type IN ('sizing','care','features','faq','styling','occasion','trends','brand_story','materials','comparison'));