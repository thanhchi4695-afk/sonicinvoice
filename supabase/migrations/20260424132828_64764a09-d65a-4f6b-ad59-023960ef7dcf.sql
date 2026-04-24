-- get_supplier_hints: summarise the user's last N feedback rows for a supplier
-- into a plain-text block that can be injected into the agent system prompt.
CREATE OR REPLACE FUNCTION public.get_supplier_hints(_supplier text, _user_id uuid, _limit int DEFAULT 25)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total int;
  edits int;
  rejects int;
  accepts int;
  overrides int;
  recent_deltas text;
  result text;
BEGIN
  IF _supplier IS NULL OR btrim(_supplier) = '' THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE feedback_type = 'edit'),
    count(*) FILTER (WHERE feedback_type = 'reject'),
    count(*) FILTER (WHERE feedback_type = 'accept'),
    count(*) FILTER (WHERE feedback_type = 'override')
  INTO total, edits, rejects, accepts, overrides
  FROM public.agent_feedback
  WHERE user_id = _user_id
    AND lower(supplier) = lower(_supplier)
    AND created_at > now() - interval '180 days';

  IF total = 0 THEN
    RETURN NULL;
  END IF;

  -- Pull a few recent non-trivial deltas (edits/overrides) as bullets
  SELECT string_agg(
    '- ' || coalesce(delta_reason, 'changed ' ||
      coalesce(original_value::text, '∅') || ' → ' || coalesce(corrected_value::text, '∅')),
    E'\n'
  )
  INTO recent_deltas
  FROM (
    SELECT delta_reason, original_value, corrected_value
    FROM public.agent_feedback
    WHERE user_id = _user_id
      AND lower(supplier) = lower(_supplier)
      AND feedback_type IN ('edit', 'override')
    ORDER BY created_at DESC
    LIMIT _limit
  ) recent;

  result := format(
    'Based on %s prior corrections from this user for %s (accepted: %s, edited: %s, overridden: %s, rejected: %s).',
    total, _supplier, accepts, edits, overrides, rejects
  );
  IF recent_deltas IS NOT NULL THEN
    result := result || E'\n\nRecent corrections:\n' || recent_deltas;
  END IF;
  RETURN result;
END;
$$;

-- get_brand_rules_text: serialise applicable brand_rules rows for a supplier
-- into a plain-text block. Public read is already allowed by RLS.
CREATE OR REPLACE FUNCTION public.get_brand_rules_text(_supplier text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rules text;
BEGIN
  IF _supplier IS NULL OR btrim(_supplier) = '' THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(
    format('- [%s] %s', rule_type, coalesce(notes, rule_data::text)),
    E'\n'
  )
  INTO rules
  FROM public.brand_rules
  WHERE lower(brand) = lower(_supplier);

  RETURN rules;
END;
$$;