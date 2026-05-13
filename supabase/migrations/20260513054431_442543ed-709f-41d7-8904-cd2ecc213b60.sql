CREATE OR REPLACE FUNCTION public.recompute_collection_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid uuid := COALESCE(NEW.suggestion_id, OLD.suggestion_id);
  v_title int := 0; v_meta int := 0; v_body int := 0;
  v_faq int := 0; v_links int := 0; v_rules int := 0; v_blog int := 0;
  v_total int := 0; v_breakdown jsonb;
  v_blog_count int := 0; v_link_count int := 0;
BEGIN
  IF TG_TABLE_NAME = 'collection_link_mesh' THEN
    v_sid := COALESCE(NEW.source_collection_id, OLD.source_collection_id);
  ELSIF TG_TABLE_NAME = 'collection_blog_plans' THEN
    v_sid := COALESCE(NEW.suggestion_id, OLD.suggestion_id);
  END IF;
  IF v_sid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT
    CASE WHEN o.seo_title IS NOT NULL AND length(o.seo_title) BETWEEN 30 AND 60 THEN 15 ELSE 0 END,
    CASE WHEN o.meta_description IS NOT NULL AND length(o.meta_description) BETWEEN 140 AND 160 THEN 15 ELSE 0 END,
    CASE WHEN o.formula_parts IS NOT NULL AND jsonb_typeof(o.formula_parts)='object'
              AND (o.formula_parts ? 'opening') AND (o.formula_parts ? 'features')
              AND (o.formula_parts ? 'styling') AND (o.formula_parts ? 'local')
              AND (o.formula_parts ? 'cta') THEN 20 ELSE 0 END,
    CASE WHEN o.faq_html IS NOT NULL AND length(o.faq_html) > 200 THEN 15 ELSE 0 END,
    CASE WHEN o.rules_status IN ('validated','ok') THEN 10 ELSE 0 END
  INTO v_title, v_meta, v_body, v_faq, v_rules
  FROM public.collection_seo_outputs o
  WHERE o.suggestion_id = v_sid
  LIMIT 1;

  SELECT count(*) INTO v_link_count FROM public.collection_link_mesh
   WHERE source_collection_id = v_sid;
  IF v_link_count >= 3 THEN v_links := 15; ELSIF v_link_count > 0 THEN v_links := 7; END IF;

  SELECT count(*) INTO v_blog_count FROM public.collection_blog_plans
   WHERE suggestion_id = v_sid;
  IF v_blog_count > 0 THEN v_blog := 10; END IF;

  v_total := COALESCE(v_title,0)+COALESCE(v_meta,0)+COALESCE(v_body,0)+COALESCE(v_faq,0)+v_links+COALESCE(v_rules,0)+v_blog;
  v_breakdown := jsonb_build_object(
    'title', COALESCE(v_title,0), 'meta', COALESCE(v_meta,0), 'body', COALESCE(v_body,0),
    'faq', COALESCE(v_faq,0), 'links', v_links, 'rules', COALESCE(v_rules,0), 'blog', v_blog
  );

  UPDATE public.collection_suggestions
     SET completeness_score = v_total, completeness_breakdown = v_breakdown
   WHERE id = v_sid;

  RETURN COALESCE(NEW, OLD);
END;
$$;