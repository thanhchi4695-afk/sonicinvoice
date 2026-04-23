-- Backfill: normalise vendor casing across supplier-related tables so the
-- Supplier Intelligence + Brain panels show a single canonical name per
-- vendor (e.g. "SIGNIFICANT OTHER" → "Significant Other", "summi" → "Summi").
-- Uses the existing public.normalise_vendor() SQL helper.

-- 1. supplier_intelligence — primary store for the Brain.
UPDATE public.supplier_intelligence
SET supplier_name = public.normalise_vendor(supplier_name)
WHERE supplier_name IS NOT NULL
  AND supplier_name <> public.normalise_vendor(supplier_name);

-- 2. supplier_profiles — referenced by invoice_patterns via supplier_profile_id.
UPDATE public.supplier_profiles
SET supplier_name = public.normalise_vendor(supplier_name)
WHERE supplier_name IS NOT NULL
  AND supplier_name <> public.normalise_vendor(supplier_name);

-- 3. documents — used by the Invoices list and accounting push.
UPDATE public.documents
SET supplier_name = public.normalise_vendor(supplier_name)
WHERE supplier_name IS NOT NULL
  AND supplier_name <> public.normalise_vendor(supplier_name);

-- 4. supplier_learning_log — keeps audit trail consistent with current names.
UPDATE public.supplier_learning_log
SET supplier_name = public.normalise_vendor(supplier_name)
WHERE supplier_name IS NOT NULL
  AND supplier_name <> public.normalise_vendor(supplier_name);