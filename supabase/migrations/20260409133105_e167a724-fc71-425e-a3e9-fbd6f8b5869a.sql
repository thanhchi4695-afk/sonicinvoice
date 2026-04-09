-- Markdown Ladders
CREATE TABLE public.markdown_ladders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'time',
  selection_type TEXT NOT NULL DEFAULT 'tag',
  selection_value TEXT NOT NULL DEFAULT '',
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'scheduled',
  auto_rollback BOOLEAN NOT NULL DEFAULT false,
  rollback_days INTEGER,
  check_frequency TEXT NOT NULL DEFAULT 'daily',
  min_margin_pct NUMERIC NOT NULL DEFAULT 30,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.markdown_ladders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own markdown ladders"
  ON public.markdown_ladders
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_markdown_ladders_updated_at
  BEFORE UPDATE ON public.markdown_ladders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Markdown Ladder Items
CREATE TABLE public.markdown_ladder_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ladder_id UUID NOT NULL REFERENCES public.markdown_ladders(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.variants(id) ON DELETE CASCADE,
  product_title TEXT NOT NULL DEFAULT '',
  variant_info TEXT,
  original_price NUMERIC NOT NULL DEFAULT 0,
  current_price NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC,
  current_stage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  block_reason TEXT,
  margin_pct NUMERIC,
  last_sale_at TIMESTAMP WITH TIME ZONE,
  days_since_last_sale INTEGER NOT NULL DEFAULT 0,
  next_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  stage_applied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.markdown_ladder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own markdown ladder items"
  ON public.markdown_ladder_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_markdown_ladder_items_ladder ON public.markdown_ladder_items(ladder_id);
CREATE INDEX idx_markdown_ladder_items_status ON public.markdown_ladder_items(status);
CREATE INDEX idx_markdown_ladder_items_next_check ON public.markdown_ladder_items(next_check_at);