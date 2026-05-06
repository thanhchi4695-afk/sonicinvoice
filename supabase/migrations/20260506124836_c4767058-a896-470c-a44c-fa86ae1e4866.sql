ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS auto_approve_stock_check boolean NOT NULL DEFAULT false;

UPDATE public.user_preferences
   SET auto_approve_stock_check = false
 WHERE auto_approve_stock_check IS NULL;