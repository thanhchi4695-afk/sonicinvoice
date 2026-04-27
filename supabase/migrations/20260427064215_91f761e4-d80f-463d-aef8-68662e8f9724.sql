ALTER TABLE public.supplier_profiles
  ADD CONSTRAINT supplier_profiles_user_supplier_unique UNIQUE (user_id, supplier_name);