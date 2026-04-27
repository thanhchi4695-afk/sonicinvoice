CREATE TABLE public.stock_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  total_skus INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  total_cost_value NUMERIC NOT NULL DEFAULT 0,
  total_retail_value NUMERIC NOT NULL DEFAULT 0,
  location_filter TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_snapshots_user_date ON public.stock_snapshots(user_id, snapshot_date DESC);

ALTER TABLE public.stock_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own snapshots" ON public.stock_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own snapshots" ON public.stock_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own snapshots" ON public.stock_snapshots
  FOR DELETE USING (auth.uid() = user_id);