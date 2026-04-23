-- Backfill supplier_intelligence.column_map from the most recent invoice_patterns row.
-- Fixes Brain showing "Not learned yet" for suppliers whose pattern data
-- was stored only in invoice_patterns and never echoed back to supplier_intelligence
-- (the extract-supplier-pattern edge function previously did not return column_map).
WITH latest AS (
  SELECT DISTINCT ON (sp.user_id, lower(sp.supplier_name))
    sp.user_id,
    lower(sp.supplier_name) AS lname,
    ip.column_map,
    ip.size_system,
    ip.gst_included_in_cost
  FROM invoice_patterns ip
  JOIN supplier_profiles sp ON sp.id = ip.supplier_profile_id
  WHERE ip.column_map IS NOT NULL
    AND ip.column_map <> '{}'::jsonb
  ORDER BY sp.user_id, lower(sp.supplier_name), ip.updated_at DESC
)
UPDATE supplier_intelligence si
SET
  column_map = COALESCE(latest.column_map, si.column_map),
  size_system = COALESCE(si.size_system, latest.size_system),
  gst_on_cost = COALESCE(si.gst_on_cost, latest.gst_included_in_cost)
FROM latest
WHERE si.user_id = latest.user_id
  AND lower(si.supplier_name) = latest.lname
  AND (si.column_map IS NULL OR si.column_map = '{}'::jsonb);