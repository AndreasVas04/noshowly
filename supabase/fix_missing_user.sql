-- One-time fix: create missing users + salons records for an existing auth user.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING.

DO $$
DECLARE
  v_user_id  UUID := 'af8c61f9-aba5-4654-ba68-85772c295d3a';
  v_email    TEXT := 'avasiliou04@gmail.com';
  v_salon_name TEXT := 'My Salon';
BEGIN
  INSERT INTO public.users (id, email, plan, created_at)
  VALUES (v_user_id, v_email, 'trial', NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.salons (id, user_id, name, timezone, created_at)
  SELECT gen_random_uuid(), v_user_id, v_salon_name, 'UTC', NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.salons WHERE user_id = v_user_id
  );
END $$;
