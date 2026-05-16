
CREATE TABLE IF NOT EXISTS public.sonic_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, key)
);

CREATE INDEX IF NOT EXISTS idx_sonic_agent_settings_shop ON public.sonic_agent_settings(shop_id);

ALTER TABLE public.sonic_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop members can view agent settings"
  ON public.sonic_agent_settings FOR SELECT
  TO authenticated
  USING (public.is_shop_member(shop_id));

CREATE POLICY "Shop members can insert agent settings"
  ON public.sonic_agent_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_shop_member(shop_id));

CREATE POLICY "Shop members can update agent settings"
  ON public.sonic_agent_settings FOR UPDATE
  TO authenticated
  USING (public.is_shop_member(shop_id))
  WITH CHECK (public.is_shop_member(shop_id));

CREATE POLICY "Shop members can delete agent settings"
  ON public.sonic_agent_settings FOR DELETE
  TO authenticated
  USING (public.is_shop_member(shop_id));

CREATE TRIGGER trg_sonic_agent_settings_updated_at
  BEFORE UPDATE ON public.sonic_agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
