CREATE TABLE public.user_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_knowledge_user ON public.user_knowledge(user_id, category);

ALTER TABLE public.user_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own knowledge" ON public.user_knowledge
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own knowledge" ON public.user_knowledge
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own knowledge" ON public.user_knowledge
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own knowledge" ON public.user_knowledge
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_knowledge_updated_at
  BEFORE UPDATE ON public.user_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();