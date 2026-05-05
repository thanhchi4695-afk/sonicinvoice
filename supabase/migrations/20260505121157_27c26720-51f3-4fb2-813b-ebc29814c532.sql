CREATE TABLE IF NOT EXISTS public.retailer_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  store_name text,
  store_url text,
  source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_retailer_waitlist_email ON public.retailer_waitlist (lower(email));
ALTER TABLE public.retailer_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join waitlist"
  ON public.retailer_waitlist FOR INSERT
  TO anon, authenticated
  WITH CHECK (email IS NOT NULL AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

CREATE POLICY "Admins read waitlist"
  ON public.retailer_waitlist FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));