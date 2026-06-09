-- Migration: add_staff_services.sql
-- Adds a staff_services table so each staff member can have their own service list
-- on the public booking page. This is separate from the global `services` table
-- which is still used by the dashboard appointment modal.

CREATE TABLE IF NOT EXISTS public.staff_services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id        UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  price            DECIMAL(10, 2) CHECK (price >= 0),
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

-- Owner policy: authenticated users can manage their own staff's services.
-- Ownership chain: staff_services → barbers → salons → users.
CREATE POLICY "Users own staff services"
  ON public.staff_services
  FOR ALL
  USING (
    barber_id IN (
      SELECT b.id
      FROM public.barbers b
      JOIN public.salons s ON s.id = b.salon_id
      WHERE s.user_id = auth.uid()
    )
  );

-- Public read policy: anyone can view active staff services.
-- Needed for the public booking page to show available services per staff member.
CREATE POLICY "Public can view active staff services"
  ON public.staff_services
  FOR SELECT
  USING (active = true);
