CREATE TABLE public.supplier_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  supplier_name text NOT NULL,
  name_variants text[] NOT NULL DEFAULT '{}',
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score integer NOT NULL DEFAULT 20 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  invoice_count integer NOT NULL DEFAULT 0,
  size_system text,
  sku_prefix_pattern text,
  gst_on_cost boolean,
  gst_on_rrp boolean,
  markup_multiplier numeric,
  last_invoice_date timestamp with time zone,
  last_match_method text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, supplier_name)
);

ALTER TABLE public.supplier_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own supplier intelligence"
  ON public.supplier_intelligence
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_supplier_intelligence_updated_at
  BEFORE UPDATE ON public.supplier_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_supplier_intelligence_user ON public.supplier_intelligence (user_id, supplier_name);

-- Learning Log: chronological events for the Supplier Intelligence panel.
CREATE TABLE public.supplier_learning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  supplier_name text NOT NULL,
  event_type text NOT NULL,
  match_method text,
  confidence_before integer,
  confidence_after integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_learning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own supplier learning log"
  ON public.supplier_learning_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_supplier_learning_log_user ON public.supplier_learning_log (user_id, created_at DESC);