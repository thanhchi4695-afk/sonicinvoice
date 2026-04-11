
CREATE TABLE public.supplier_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  supplier_name TEXT NOT NULL,
  column_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
  regex_patterns JSONB NOT NULL DEFAULT '{}'::jsonb,
  header_row INTEGER NOT NULL DEFAULT 1,
  file_type TEXT NOT NULL DEFAULT 'csv',
  notes TEXT DEFAULT '',
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, supplier_name)
);

ALTER TABLE public.supplier_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own supplier templates"
ON public.supplier_templates
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_supplier_templates_updated_at
BEFORE UPDATE ON public.supplier_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
