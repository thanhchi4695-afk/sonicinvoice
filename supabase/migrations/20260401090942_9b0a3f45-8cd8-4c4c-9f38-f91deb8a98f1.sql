CREATE TABLE IF NOT EXISTS public.shopify_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  shop text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.shopify_oauth_states ENABLE ROW LEVEL SECURITY;

-- Only the service role accesses this table (from edge functions), no user policies needed
-- But add a policy so authenticated users can read their own state for safety
CREATE POLICY "Users can read own oauth state" ON public.shopify_oauth_states
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
