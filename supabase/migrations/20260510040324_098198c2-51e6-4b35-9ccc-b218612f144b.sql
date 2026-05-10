CREATE OR REPLACE FUNCTION public.get_supplier_correction_rollup(_days int DEFAULT 90)
RETURNS TABLE(supplier_key text, total_count bigint, last3_avg numeric, flag_enrichment boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH recent AS (
    SELECT supplier_key, invoice_job_id, created_at
    FROM public.corrections
    WHERE user_id = auth.uid()
      AND created_at > now() - (_days || ' days')::interval
      AND supplier_key IS NOT NULL
      AND btrim(supplier_key) <> ''
  ),
  per_job AS (
    SELECT lower(btrim(supplier_key)) AS sk,
           invoice_job_id,
           COUNT(*) AS job_count,
           MAX(created_at) AS job_ts
    FROM recent
    WHERE invoice_job_id IS NOT NULL
    GROUP BY lower(btrim(supplier_key)), invoice_job_id
  ),
  last3 AS (
    SELECT sk, job_count,
           ROW_NUMBER() OVER (PARTITION BY sk ORDER BY job_ts DESC) AS rn
    FROM per_job
  ),
  avg3 AS (
    SELECT sk, AVG(job_count)::numeric AS last3_avg
    FROM last3 WHERE rn <= 3
    GROUP BY sk
  ),
  totals AS (
    SELECT lower(btrim(supplier_key)) AS sk, COUNT(*)::bigint AS total
    FROM recent
    GROUP BY lower(btrim(supplier_key))
  )
  SELECT t.sk AS supplier_key,
         t.total AS total_count,
         COALESCE(a.last3_avg, 0) AS last3_avg,
         COALESCE(a.last3_avg, 0) > 5 AS flag_enrichment
  FROM totals t
  LEFT JOIN avg3 a USING (sk);
$$;