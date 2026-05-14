-- 1) New table for GEO answer blocks
CREATE TABLE IF NOT EXISTS public.collection_geo_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_suggestion_id UUID NOT NULL REFERENCES public.collection_suggestions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scenario_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  comparison_snippet JSONB,
  care_instructions JSONB,
  best_for_summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published')),
  validation_errors JSONB,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_suggestion_id)
);

CREATE INDEX IF NOT EXISTS idx_geo_blocks_user ON public.collection_geo_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_geo_blocks_status ON public.collection_geo_blocks(status);

ALTER TABLE public.collection_geo_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their GEO blocks"
  ON public.collection_geo_blocks FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners insert their GEO blocks"
  ON public.collection_geo_blocks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners update their GEO blocks"
  ON public.collection_geo_blocks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Owners delete their GEO blocks"
  ON public.collection_geo_blocks FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_geo_blocks_updated
  BEFORE UPDATE ON public.collection_geo_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Mirror geo_ready onto the suggestion
ALTER TABLE public.collection_suggestions
  ADD COLUMN IF NOT EXISTS geo_ready BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_collection_geo_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.collection_suggestions
       SET geo_ready = false
     WHERE id = OLD.collection_suggestion_id;
    RETURN OLD;
  END IF;

  UPDATE public.collection_suggestions
     SET geo_ready = (NEW.status = 'published')
   WHERE id = NEW.collection_suggestion_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_geo_blocks_sync_ready ON public.collection_geo_blocks;
CREATE TRIGGER trg_geo_blocks_sync_ready
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.collection_geo_blocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_collection_geo_ready();
