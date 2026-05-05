CREATE OR REPLACE FUNCTION public.get_public_brand_guide()
RETURNS TABLE (
  brand_name text,
  invoices_parsed bigint,
  avg_accuracy numeric,
  supplier_sku_format text,
  size_schema text,
  retailers bigint,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bp.brand_name,
    COALESCE(SUM(bp.sample_count), 0)::bigint AS invoices_parsed,
    ROUND(AVG(NULLIF(bp.accuracy_rate, 0))::numeric, 3) AS avg_accuracy,
    (mode() WITHIN GROUP (ORDER BY bp.supplier_sku_format)) AS supplier_sku_format,
    (mode() WITHIN GROUP (ORDER BY bp.size_schema)) AS size_schema,
    COUNT(DISTINCT bp.user_id)::bigint AS retailers,
    MAX(bp.updated_at) AS last_seen_at
  FROM public.brand_patterns bp
  WHERE bp.brand_name IS NOT NULL AND btrim(bp.brand_name) <> ''
  GROUP BY bp.brand_name
  HAVING COALESCE(SUM(bp.sample_count), 0) > 0
  ORDER BY invoices_parsed DESC, brand_name ASC
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_brand_guide() TO anon, authenticated;