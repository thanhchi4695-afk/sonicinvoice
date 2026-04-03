
CREATE TABLE public.shopify_login_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  shop TEXT NOT NULL,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_login_tokens ENABLE ROW LEVEL SECURITY;

-- No public RLS policies — only service role can access this table
-- Tokens are consumed and deleted by the edge function
