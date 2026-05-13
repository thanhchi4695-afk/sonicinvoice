CREATE OR REPLACE FUNCTION public.recompute_collection_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid uuid := COALESCE(NEW.suggestion_id, OLD.suggestion_id);
  v_title int := 0;
  v_meta int := 0;
  v_body int := 0;
  v_faq int := 0;
  v_links int := 0;
  v_rules int := 0;
  v_blog int := 0;
  v_total int := 0;
  v_breakdown jsonb;
  v_blog_count int := 0;
  v_link_count int := 0;
BEGIN
  IF v_sid IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.seo_title IS NOT NULL AND length(NEW.seo_title) BETWEEN 30 AND 60 THEN v_title := 15; END IF;
    IF NEW.meta_description IS NOT NULL AND length(NEW.meta_description) BETWEEN 140 AND 160 THEN v_meta := 15; END IF;
    IF NEW.formula_parts IS NOT NULL
       AND jsonb_typeof(NEW.formula_parts) = 'object'
       AND (NEW.formula_parts ? 'opening')
       AND (NEW.formula_parts ? 'features')
       AND (NEW.formula_parts ? 'styling')
       AND (NEW.formula_parts ? 'local')
       AND (NEW.formula_parts ? 'cta') THEN v_body := 20; END IF;
    IF NEW.faq_html IS NOT NULL AND length(NEW.faq_html) > 200 THEN v_faq := 15; END IF;
    IF NEW.rules_status = 'validated' OR NEW.rules_status = 'ok' THEN v_rules := 10; END IF;
  END IF;

  SELECT count(*) INTO v_link_count FROM public.collection_link_mesh
   WHERE source_suggestion_id = v_sid;
  IF v_link_count >= 3 THEN v_links := 15; ELSIF v_link_count > 0 THEN v_links := 7; END IF;

  SELECT count(*) INTO v_blog_count FROM public.collection_blog_plans
   WHERE suggestion_id = v_sid;
  IF v_blog_count > 0 THEN v_blog := 10; END IF;

  v_total := v_title + v_meta + v_body + v_faq + v_links + v_rules + v_blog;
  v_breakdown := jsonb_build_object(
    'title', v_title, 'meta', v_meta, 'body', v_body,
    'faq', v_faq, 'links', v_links, 'rules', v_rules, 'blog', v_blog
  );

  UPDATE public.collection_suggestions
     SET completeness_score = v_total,
         completeness_breakdown = v_breakdown
   WHERE id = v_sid;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seo_outputs_completeness ON public.collection_seo_outputs;
CREATE TRIGGER trg_seo_outputs_completeness
AFTER INSERT OR UPDATE OR DELETE ON public.collection_seo_outputs
FOR EACH ROW EXECUTE FUNCTION public.recompute_collection_completeness();

DROP TRIGGER IF EXISTS trg_link_mesh_completeness ON public.collection_link_mesh;
CREATE TRIGGER trg_link_mesh_completeness
AFTER INSERT OR DELETE ON public.collection_link_mesh
FOR EACH ROW EXECUTE FUNCTION public.recompute_collection_completeness();

DROP TRIGGER IF EXISTS trg_blog_plan_completeness ON public.collection_blog_plans;
CREATE TRIGGER trg_blog_plan_completeness
AFTER INSERT OR DELETE ON public.collection_blog_plans
FOR EACH ROW EXECUTE FUNCTION public.recompute_collection_completeness();