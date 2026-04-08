-- Drop the existing INSERT policy that allows users to insert arbitrary subscription data
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.shopify_subscriptions;

-- Drop existing UPDATE policy to restrict it too
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.shopify_subscriptions;

-- Also secure shopify_login_tokens - add SELECT policy so the table isn't fully locked
DROP POLICY IF EXISTS "Users can read own login tokens" ON public.shopify_login_tokens;
CREATE POLICY "Users can read own login tokens"
  ON public.shopify_login_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Add INSERT/DELETE policies for shopify_oauth_states since the OAuth flow needs them
DROP POLICY IF EXISTS "Users can insert own oauth states" ON public.shopify_oauth_states;
CREATE POLICY "Users can insert own oauth states"
  ON public.shopify_oauth_states
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own oauth states" ON public.shopify_oauth_states;
CREATE POLICY "Users can delete own oauth states"
  ON public.shopify_oauth_states
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());