-- =============================================================================
-- NoShowly — Complete Database Schema + RLS Policies
-- =============================================================================
-- Run this entire file in the Supabase SQL Editor (supabase.com → your project
-- → SQL Editor → New query → paste → Run).
--
-- Prerequisites: Supabase Auth must be enabled (it is by default on all projects).
-- This script is idempotent: safe to re-run if tables already exist.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- pg_cron is used later (Day 5) to run the reminder job every hour.
-- Enable it now so it is ready when needed.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users
-- Extends auth.users (managed by Supabase Auth) with NoShowly-specific fields.
-- One row per salon owner account.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id                       UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    TEXT        NOT NULL,
  stripe_customer_id       TEXT,
  -- 'trial' | 'solo' | 'salon' | 'studio' | 'cancelled'
  plan                     TEXT        NOT NULL DEFAULT 'trial',
  trial_ends_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  reminders_used_this_month INTEGER    NOT NULL DEFAULT 0,
  reminders_reset_at       TIMESTAMPTZ NOT NULL DEFAULT (DATE_TRUNC('month', NOW()) + INTERVAL '1 month'),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- salons
-- One salon per user account.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,           -- e.g. "Salon Elena"
  phone           TEXT,                           -- salon's own contact number
  timezone        TEXT        NOT NULL DEFAULT 'UTC', -- IANA timezone e.g. "America/New_York"
  sms_sender_name TEXT,                           -- shown in SMS: "Hi, reminder from [sms_sender_name]"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- barbers
-- Display labels (dropdown items) only — NOT login accounts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barbers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,   -- e.g. "John" or "Maria"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- clients
-- The salon's end customers. They NEVER log in — they only receive reminders.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  phone      TEXT,                   -- required for SMS reminders
  email      TEXT,                   -- optional, for email reminders
  notes      TEXT,                   -- e.g. "allergic to X product"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- appointments
-- Core entity — one row per booked slot.
-- Status flow: scheduled → confirmed (client replied YES) | cancelled (NO)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id        UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  barber_id        UUID        REFERENCES public.barbers(id) ON DELETE SET NULL,
  datetime         TIMESTAMPTZ NOT NULL,
  service_type     TEXT,               -- 'Haircut' | 'Shave' | 'Colour' | 'Other'
  duration_minutes INTEGER     NOT NULL DEFAULT 30,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'confirmed' | 'cancelled'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- reminders
-- One row per SMS or email sent (or attempted). Tracks the full delivery lifecycle.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL,   -- 'sms' | 'email'
  send_at        TIMESTAMPTZ NOT NULL,   -- when it was scheduled to go out
  sent_at        TIMESTAMPTZ,            -- when it was actually sent (null = not yet)
  -- 'pending' | 'sent' | 'failed' | 'confirmed' | 'cancelled'
  status         TEXT        NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- INDEXES
-- These speed up the most common queries in the application.
-- =============================================================================

-- Appointments by salon + date range (dashboard calendar view)
CREATE INDEX IF NOT EXISTS idx_appointments_salon_datetime
  ON public.appointments (salon_id, datetime);

-- Appointments by status (dashboard stats + cron filter)
CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON public.appointments (status);

-- Reminders pending send (hourly cron job scan)
CREATE INDEX IF NOT EXISTS idx_reminders_status_send_at
  ON public.reminders (status, send_at)
  WHERE status = 'pending';

-- Barbers by salon (settings page list)
CREATE INDEX IF NOT EXISTS idx_barbers_salon_id
  ON public.barbers (salon_id);

-- Clients by salon (autocomplete search)
CREATE INDEX IF NOT EXISTS idx_clients_salon_id
  ON public.clients (salon_id);


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Every table is locked down so each salon owner can only see their own data.
-- RLS is a second enforcement layer on top of application-level auth checks.
-- =============================================================================

ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders    ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- users policies
-- A user can only read or update their own row. No user can insert directly —
-- the /api/auth/register route uses the service-role key for the initial insert.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "users: owner select" ON public.users;
CREATE POLICY "users: owner select"
  ON public.users FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "users: owner update" ON public.users;
CREATE POLICY "users: owner update"
  ON public.users FOR UPDATE
  USING (id = auth.uid());


-- -----------------------------------------------------------------------------
-- salons policies
-- A user can only access the salon whose user_id matches their auth UID.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "salons: owner all" ON public.salons;
CREATE POLICY "salons: owner all"
  ON public.salons FOR ALL
  USING (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- barbers policies
-- A user can only access barbers belonging to their own salon.
-- The sub-select is safe: RLS on salons already enforces ownership.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "barbers: owner all" ON public.barbers;
CREATE POLICY "barbers: owner all"
  ON public.barbers FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- clients policies
-- Same pattern as barbers — scoped to the authenticated user's salon.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clients: owner all" ON public.clients;
CREATE POLICY "clients: owner all"
  ON public.clients FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- appointments policies
-- Scoped to the authenticated user's salon.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "appointments: owner all" ON public.appointments;
CREATE POLICY "appointments: owner all"
  ON public.appointments FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- reminders policies
-- Reminders are scoped via appointments → salons → auth.uid().
-- This triple-join is intentional — reminders have no direct salon_id column.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "reminders: owner all" ON public.reminders;
CREATE POLICY "reminders: owner all"
  ON public.reminders FOR ALL
  USING (
    appointment_id IN (
      SELECT id FROM public.appointments
      WHERE salon_id IN (
        SELECT id FROM public.salons WHERE user_id = auth.uid()
      )
    )
  );


-- =============================================================================
-- DONE
-- =============================================================================
-- After running this script:
-- 1. Confirm all 6 tables appear in the Table Editor.
-- 2. Confirm RLS is ON for all 6 tables (shield icon in Table Editor).
-- 3. No data is created here — the /api/auth/register route creates the first
--    users + salons rows when the salon owner signs up.
-- =============================================================================
