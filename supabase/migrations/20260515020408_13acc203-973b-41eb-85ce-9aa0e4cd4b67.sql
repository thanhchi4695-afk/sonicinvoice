
CREATE TABLE IF NOT EXISTS public.invoice_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gmail','drive','api')),
  source_ref text,
  original_filename text,
  storage_bucket text,
  storage_path text,
  supplier text,
  invoice_number text,
  invoice_date date,
  currency text,
  subtotal numeric(14,2),
  tax numeric(14,2),
  total numeric(14,2),
  line_count int NOT NULL DEFAULT 0,
  matched_count int NOT NULL DEFAULT 0,
  unmatched_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','parsing','parsed','review','exported','failed')),
  confidence numeric(5,2),
  error_message text,
  parsed_at timestamptz,
  exported_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_uploads_user_created ON public.invoice_uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_uploads_user_status ON public.invoice_uploads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_invoice_uploads_source ON public.invoice_uploads(user_id, source);

ALTER TABLE public.invoice_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uploads_select_own" ON public.invoice_uploads;
DROP POLICY IF EXISTS "uploads_insert_own" ON public.invoice_uploads;
DROP POLICY IF EXISTS "uploads_update_own" ON public.invoice_uploads;
DROP POLICY IF EXISTS "uploads_delete_own" ON public.invoice_uploads;
CREATE POLICY "uploads_select_own" ON public.invoice_uploads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "uploads_insert_own" ON public.invoice_uploads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "uploads_update_own" ON public.invoice_uploads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "uploads_delete_own" ON public.invoice_uploads FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_invoice_uploads_updated ON public.invoice_uploads;
CREATE TRIGGER trg_invoice_uploads_updated
BEFORE UPDATE ON public.invoice_uploads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_upload_id uuid NOT NULL REFERENCES public.invoice_uploads(id) ON DELETE CASCADE,
  line_index int NOT NULL DEFAULT 0,
  sku text,
  barcode text,
  description text,
  color text,
  size text,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,4),
  line_total numeric(14,2),
  matched_variant_id uuid,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','manual','ignored')),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_upload ON public.invoice_lines(invoice_upload_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_user ON public.invoice_lines(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_sku ON public.invoice_lines(user_id, sku);

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lines_select_own" ON public.invoice_lines;
DROP POLICY IF EXISTS "lines_insert_own" ON public.invoice_lines;
DROP POLICY IF EXISTS "lines_update_own" ON public.invoice_lines;
DROP POLICY IF EXISTS "lines_delete_own" ON public.invoice_lines;
CREATE POLICY "lines_select_own" ON public.invoice_lines FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "lines_insert_own" ON public.invoice_lines FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lines_update_own" ON public.invoice_lines FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "lines_delete_own" ON public.invoice_lines FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_invoice_lines_updated ON public.invoice_lines;
CREATE TRIGGER trg_invoice_lines_updated
BEFORE UPDATE ON public.invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS product_title text;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS price numeric(14,4);
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS shopify_product_id text;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_variants_user ON public.variants(user_id);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON public.variants(user_id, barcode);
CREATE INDEX IF NOT EXISTS idx_variants_supplier ON public.variants(user_id, supplier);
CREATE INDEX IF NOT EXISTS idx_variants_user_sku ON public.variants(user_id, sku);

ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "variants_select_own" ON public.variants;
DROP POLICY IF EXISTS "variants_insert_own" ON public.variants;
DROP POLICY IF EXISTS "variants_update_own" ON public.variants;
DROP POLICY IF EXISTS "variants_delete_own" ON public.variants;
CREATE POLICY "variants_select_own" ON public.variants FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "variants_insert_own" ON public.variants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "variants_update_own" ON public.variants FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "variants_delete_own" ON public.variants FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_variants_updated ON public.variants;
CREATE TRIGGER trg_variants_updated
BEFORE UPDATE ON public.variants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_matched_variant_fk;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_matched_variant_fk
  FOREIGN KEY (matched_variant_id) REFERENCES public.variants(id) ON DELETE SET NULL;
