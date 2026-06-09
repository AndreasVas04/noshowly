-- add_booking_phase1.sql
--
-- Phase 1 of the public booking page feature.
--
-- What this migration does:
--   1. Extends the existing `services` table with duration, price, and active flag.
--   2. Extends the existing `barbers` table with photo, bio, and active flag.
--   3. Creates the new `booking_pages` table (one per salon, optional slug-based public page).
--   4. Adds public-read RLS policies needed by the unauthenticated booking flow.
--
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF NOT EXISTS guards.
-- Run this in the Supabase SQL editor or via the Supabase CLI.

-- ---------------------------------------------------------------------------
-- 1. Extend `services` table
-- ---------------------------------------------------------------------------

-- Duration hint shown on the public booking page (e.g. 30 = "30 min").
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Optional displayed price. NULL means no price shown.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);

-- Soft-delete flag. Inactive services are hidden from the booking page and
-- from the appointment modal dropdown, but their historical data is preserved.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Extend `barbers` table
-- ---------------------------------------------------------------------------

-- Optional profile photo URL (e.g. a Supabase Storage public URL).
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Short bio shown on the public booking page.
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- Soft-delete flag. Inactive staff are hidden from the booking page and
-- from the appointment modal dropdown.
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 3. Create `booking_pages` table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_pages (
  -- Primary key
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One booking page per salon — enforced by UNIQUE constraint.
  -- Cascade delete: if the salon is deleted, its booking page goes too.
  salon_id    UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  UNIQUE (salon_id),

  -- URL-friendly slug, e.g. "salon-elena" → /book/salon-elena
  slug        TEXT        NOT NULL UNIQUE,

  -- Owner must explicitly activate the page; new pages are inactive by default.
  is_active   BOOLEAN     NOT NULL DEFAULT false,

  -- Optional public description shown at the top of the booking page.
  description TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS (required — matches every other table in this project).
ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;

-- Owner policy: the authenticated salon owner can do everything on their own page.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'booking_pages'
      AND policyname = 'Users own booking page'
  ) THEN
    CREATE POLICY "Users own booking page"
      ON public.booking_pages
      FOR ALL
      USING (
        salon_id IN (
          SELECT id FROM public.salons WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Public read policy: unauthenticated visitors can only read active pages
-- (needed so the public /book/[slug] route can fetch page metadata without auth).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'booking_pages'
      AND policyname = 'Public can view active booking pages'
  ) THEN
    CREATE POLICY "Public can view active booking pages"
      ON public.booking_pages
      FOR SELECT
      USING (is_active = true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Public-read RLS policies for the unauthenticated booking flow
--
-- Each block is wrapped in DO/EXCEPTION so a pre-existing policy does not
-- abort the whole migration. All policies are SELECT-only (or INSERT-only
-- for appointments) — they do not relax owner write access.
-- ---------------------------------------------------------------------------

-- 4a. Public can read basic salon info (name, timezone) to render the page header.
DO $$
BEGIN
  CREATE POLICY "Public can view salon info for booking"
    ON public.salons
    FOR SELECT
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "Public can view salon info for booking" already exists — skipping.';
END $$;

-- 4b. Public can read active services to populate the service picker.
DO $$
BEGIN
  CREATE POLICY "Public can view active services"
    ON public.services
    FOR SELECT
    USING (active = true);
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "Public can view active services" already exists — skipping.';
END $$;

-- 4c. Public can read active barbers to populate the staff picker.
DO $$
BEGIN
  CREATE POLICY "Public can view active barbers"
    ON public.barbers
    FOR SELECT
    USING (active = true);
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "Public can view active barbers" already exists — skipping.';
END $$;

-- 4d. Public can INSERT appointments via the booking page.
--     The application route (POST /api/book/[slug]) validates all fields and
--     enforces double-booking checks before inserting — this policy only
--     unlocks the INSERT at the DB level for the anon role.
DO $$
BEGIN
  CREATE POLICY "Public can create appointments via booking"
    ON public.appointments
    FOR INSERT
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "Public can create appointments via booking" already exists — skipping.';
END $$;
