
ALTER TABLE public.collection_suggestions DROP CONSTRAINT IF EXISTS collection_suggestions_collection_type_check;
ALTER TABLE public.collection_suggestions ADD CONSTRAINT collection_suggestions_collection_type_check
  CHECK (collection_type = ANY (ARRAY[
    'brand','brand_category','type','niche','print','archive','dimension','brand_print',
    'colour','occasion','trend','sale','back_in_stock'
  ]));

ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_collection_suggestions_source
  ON public.collection_suggestions(source);
