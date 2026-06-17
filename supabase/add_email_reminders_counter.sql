-- Migration: add email reminder counter and update plan CHECK constraint.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_reminders_used_this_month INTEGER NOT NULL DEFAULT 0;

-- Drop any existing plan CHECK constraint before adding the updated one.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name
  INTO   v_constraint_name
  FROM   information_schema.table_constraints  tc
  JOIN   information_schema.check_constraints  cc
         ON tc.constraint_name = cc.constraint_name
        AND tc.constraint_schema = cc.constraint_schema
  WHERE  tc.table_schema    = 'public'
    AND  tc.table_name      = 'users'
    AND  tc.constraint_type = 'CHECK'
    AND  cc.check_clause    LIKE '%plan%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.users DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;
END;
$$;

-- Plan names aligned with lib/plans.ts PLAN_LIMITS.
-- Legacy SMS-prefixed names kept for backward compatibility with existing DB rows.
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN (
    'trial',
    'basic', 'pro', 'business',
    'starter', 'professional',
    -- Legacy plan names (may exist in older rows)
    'solo-sms', 'team-sms', 'studio-sms',
    'solo-email', 'team-email', 'studio-email',
    'solo-both', 'team-both', 'studio-both',
    'cancelled'
  ));
