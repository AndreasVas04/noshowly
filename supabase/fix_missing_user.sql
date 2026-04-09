-- =============================================================================
-- One-time fix: create missing users + salons records for an existing auth user.
--
-- Context: The auth user was created via Supabase signUp but the /api/auth/register
-- API route was never called (email confirmation was required; the callback route
-- did not create DB records at the time).
--
-- Run this once in the Supabase SQL Editor → SQL Editor → New query → Run.
-- Safe to re-run: INSERT ... ON CONFLICT DO NOTHING is idempotent.
-- =============================================================================

-- Replace with the actual auth user UUID if fixing a different account.
DO $$
DECLARE
  v_user_id  UUID := 'af8c61f9-aba5-4654-ba68-85772c295d3a';
  v_email    TEXT := 'avasiliou04@gmail.com';
  v_salon_name TEXT := 'My Salon'; -- Owner can rename this in /dashboard/settings
BEGIN

  -- Create the users row if it does not exist.
  INSERT INTO public.users (id, email, plan, created_at)
  VALUES (v_user_id, v_email, 'trial', NOW())
  ON CONFLICT (id) DO NOTHING;

  -- Create the salons row if this user does not already have one.
  INSERT INTO public.salons (id, user_id, name, timezone, created_at)
  SELECT gen_random_uuid(), v_user_id, v_salon_name, 'UTC', NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.salons WHERE user_id = v_user_id
  );

  RAISE NOTICE 'Done. users and salons records ensured for user %', v_user_id;
END $$;
