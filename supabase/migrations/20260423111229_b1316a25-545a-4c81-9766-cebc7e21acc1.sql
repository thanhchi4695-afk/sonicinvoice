-- 1) normalise_vendor(text)
CREATE OR REPLACE FUNCTION public.normalise_vendor(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cleaned text;
  word text;
  result text := '';
  i int := 0;
  total int;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN raw;
  END IF;
  cleaned := regexp_replace(btrim(raw), '\s+', ' ', 'g');
  total := array_length(string_to_array(cleaned, ' '), 1);
  FOREACH word IN ARRAY string_to_array(cleaned, ' ') LOOP
    i := i + 1;
    IF word ~ '^[A-Z0-9&]{2,}$' THEN
      result := result || word;
    ELSE
      result := result || upper(left(word, 1)) || lower(substring(word from 2));
    END IF;
    IF i < total THEN
      result := result || ' ';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- 2) Backfill missing supplier_intelligence rows
INSERT INTO public.supplier_intelligence (
  user_id, supplier_name, name_variants, column_map,
  confidence_score, invoice_count, size_system, gst_on_cost,
  last_invoice_date, last_match_method, created_at, updated_at
)
SELECT
  sp.user_id,
  public.normalise_vendor(sp.supplier_name),
  ARRAY[]::text[],
  COALESCE(
    (SELECT ip.column_map FROM public.invoice_patterns ip
     WHERE ip.supplier_profile_id = sp.id
       AND ip.column_map IS NOT NULL AND ip.column_map <> '{}'::jsonb
     ORDER BY ip.updated_at DESC LIMIT 1),
    '{}'::jsonb
  ),
  GREATEST(20, LEAST(95, COALESCE(sp.confidence_score, 30)::int)),
  GREATEST(1, COALESCE(sp.invoice_count,
    (SELECT COUNT(*) FROM public.invoice_patterns ip2 WHERE ip2.supplier_profile_id = sp.id)
  )),
  (SELECT ip.size_system FROM public.invoice_patterns ip
    WHERE ip.supplier_profile_id = sp.id ORDER BY ip.updated_at DESC LIMIT 1),
  (SELECT ip.gst_included_in_cost FROM public.invoice_patterns ip
    WHERE ip.supplier_profile_id = sp.id ORDER BY ip.updated_at DESC LIMIT 1),
  sp.updated_at,
  'full_extraction',
  sp.created_at,
  now()
FROM public.supplier_profiles sp
WHERE EXISTS (SELECT 1 FROM public.invoice_patterns ip WHERE ip.supplier_profile_id = sp.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.supplier_intelligence si
    WHERE si.user_id = sp.user_id
      AND lower(si.supplier_name) = lower(public.normalise_vendor(sp.supplier_name))
  );

-- 3) Merge casing-duplicates: sum invoice counts onto the canonical row, delete losers, then rename.
WITH ranked AS (
  SELECT
    si.id,
    si.user_id,
    si.supplier_name,
    si.invoice_count,
    si.confidence_score,
    public.normalise_vendor(si.supplier_name) AS canonical_name,
    ROW_NUMBER() OVER (
      PARTITION BY si.user_id, lower(public.normalise_vendor(si.supplier_name))
      ORDER BY si.invoice_count DESC NULLS LAST, si.updated_at DESC
    ) AS rn
  FROM public.supplier_intelligence si
),
loser_aggregates AS (
  SELECT user_id, canonical_name,
         SUM(invoice_count) AS extra_invoices,
         MAX(confidence_score) AS max_conf
  FROM ranked
  WHERE rn > 1
  GROUP BY user_id, canonical_name
)
UPDATE public.supplier_intelligence si
SET
  invoice_count = si.invoice_count + la.extra_invoices,
  confidence_score = GREATEST(si.confidence_score, COALESCE(la.max_conf, si.confidence_score))
FROM loser_aggregates la
WHERE si.user_id = la.user_id
  AND lower(public.normalise_vendor(si.supplier_name)) = lower(la.canonical_name)
  AND si.id IN (
    SELECT id FROM ranked WHERE rn = 1
      AND user_id = la.user_id
      AND lower(canonical_name) = lower(la.canonical_name)
  );

DELETE FROM public.supplier_intelligence si
USING (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id, lower(public.normalise_vendor(supplier_name))
    ORDER BY invoice_count DESC NULLS LAST, updated_at DESC
  ) AS rn
  FROM public.supplier_intelligence
) r
WHERE r.id = si.id AND r.rn > 1;

UPDATE public.supplier_intelligence
SET supplier_name = public.normalise_vendor(supplier_name)
WHERE supplier_name IS DISTINCT FROM public.normalise_vendor(supplier_name);

-- 4) Unique index to prevent future casing-dupes
CREATE UNIQUE INDEX IF NOT EXISTS supplier_intelligence_user_name_lower_idx
  ON public.supplier_intelligence (user_id, lower(supplier_name));