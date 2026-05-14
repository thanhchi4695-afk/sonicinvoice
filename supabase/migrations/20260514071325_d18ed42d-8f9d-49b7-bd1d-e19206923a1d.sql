-- 1. Tool-call activity log (user-scoped, no stores table)
CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.sonic_mcp_tokens(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  arguments jsonb,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','error')),
  duration_ms integer,
  error_message text,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_user_time
  ON public.mcp_tool_calls(user_id, called_at DESC);

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own MCP tool calls"
  ON public.mcp_tool_calls FOR SELECT
  USING (auth.uid() = user_id);

-- Inserts come from the edge function via service role, so no INSERT policy needed.

-- 2. Replace verify_sonic_mcp_token to also return Shopify connection info
DROP FUNCTION IF EXISTS public.verify_sonic_mcp_token(text);

CREATE OR REPLACE FUNCTION public.verify_sonic_mcp_token(_token_hash text)
RETURNS TABLE(user_id uuid, token_id uuid, store_url text, access_token text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    t.user_id,
    t.id AS token_id,
    sc.store_url,
    sc.access_token
  FROM public.sonic_mcp_tokens t
  LEFT JOIN public.shopify_connections sc ON sc.user_id = t.user_id
  WHERE t.token_hash = _token_hash
    AND t.revoked_at IS NULL
  LIMIT 1
$$;