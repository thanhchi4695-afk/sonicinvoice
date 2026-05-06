-- Add Sonic Assistant preferences to existing user_preferences table
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS morning_briefing_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS briefing_hour_utc int NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS proactive_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_approve_tags boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_seo boolean NOT NULL DEFAULT false;

-- Ensure RLS policy exists for full owner access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='user_preferences'
      AND policyname='users_own_preferences_all'
  ) THEN
    CREATE POLICY "users_own_preferences_all"
      ON public.user_preferences FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;