-- Migration: add_email_reminders_counter.sql
--
-- Adds the email_reminders_used_this_month column to the users table
-- and updates the plan CHECK constraint to allow the 9 new plan names.
--
-- Run in the Supabase SQL editor or via the Supabase CLI.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.
-- The CHECK constraint block uses a DO loop to find and drop any existing
-- plan constraint regardless of its name.

-- -------------------------------------------------------------------------
-- 1. Add email reminder counter
-- -------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_reminders_used_this_month INTEGER NOT NULL DEFAULT 0;

-- -------------------------------------------------------------------------
-- 2. Update the plan CHECK constraint for the new 9-plan structure
--
-- The old constraint allowed: 'trial' | 'solo' | 'team' | 'studio' | 'cancelled'
-- The new constraint allows:  'trial' | the 9 paid plan names | 'cancelled'
-- -------------------------------------------------------------------------

-- Find and drop any existing CHECK constraint on the plan column.
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
    RAISE NOTICE 'Dropped existing plan constraint: %', v_constraint_name;
  END IF;
END;
$$;

-- Add the new constraint allowing all 9 paid plan names + trial + cancelled.
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN (
    'trial',
    -- SMS-only plans
    'solo-sms', 'team-sms', 'studio-sms',
    -- Email-only plans
    'solo-email', 'team-email', 'studio-email',
    -- SMS + Email combined plans
    'solo-both', 'team-both', 'studio-both',
    -- Lapsed subscription
    'cancelled'
  ));

-- -------------------------------------------------------------------------
-- 3. (Optional) Migrate existing users on old plan names.
--
-- If you have users with plan = 'solo' | 'team' | 'studio', the constraint
-- above will prevent any further updates to those rows until they are migrated.
-- Uncomment and run the block below to migrate them to the SMS & Email plan
-- (the closest equivalent to the old unified plans).
-- -------------------------------------------------------------------------

-- UPDATE public.users SET plan = 'solo-both'   WHERE plan = 'solo';
-- UPDATE public.users SET plan = 'team-both'   WHERE plan = 'team';
-- UPDATE public.users SET plan = 'studio-both' WHERE plan = 'studio';
