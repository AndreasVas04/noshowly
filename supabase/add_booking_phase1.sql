-- Migration: public booking page (phase 1).
-- Extends services/barbers tables and creates booking_pages.

-- Extend services
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Extend barbers
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- booking_pages: one per salon, slug-based public URL.
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  UNIQUE (salon_id),
  slug        TEXT        NOT NULL UNIQUE,
  is_active   BOOLEAN     NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;

-- Owner policy
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

-- Public read: unauthenticated visitors can view active booking pages.
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

-- Public-read RLS policies for the unauthenticated booking flow.
-- Each block handles pre-existing policy gracefully.

DO $$
BEGIN
  CREATE POLICY "Public can view salon info for booking"
    ON public.salons FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Public can view active services"
    ON public.services FOR SELECT USING (active = true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Public can view active barbers"
    ON public.barbers FOR SELECT USING (active = true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Public can INSERT appointments via the booking page.
-- Validation and double-booking checks are enforced in the API route.
DO $$
BEGIN
  CREATE POLICY "Public can create appointments via booking"
    ON public.appointments FOR INSERT WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
