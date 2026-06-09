-- add_booking_phase2.sql
--
-- Phase 2 of the Online Booking feature: staff availability scheduling.
--
-- Adds the staff_availability table so each barber can define which days
-- and time ranges they are available for online bookings.
--
-- day_of_week follows JavaScript's Date.getDay() convention:
--   0 = Sunday, 1 = Monday, 2 = Tuesday, ..., 6 = Saturday
--
-- Two optional time slots (start/end × 2) allow a morning/afternoon split,
-- e.g. 09:00–13:00 then 14:00–18:00 with a lunch break in between.

-- ---------------------------------------------------------------------------
-- Table: staff_availability
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_availability (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id    UUID    NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_available BOOLEAN NOT NULL DEFAULT true,
  start_time_1 TIME,
  end_time_1   TIME,
  start_time_2 TIME,
  end_time_2   TIME,
  UNIQUE (barber_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

-- Business owners can manage their own staff's availability.
-- Ownership is verified by tracing barber → salon → user.
CREATE POLICY "Users own staff availability"
  ON public.staff_availability
  FOR ALL
  USING (
    barber_id IN (
      SELECT b.id
      FROM   barbers b
      JOIN   salons  s ON s.id = b.salon_id
      WHERE  s.user_id = auth.uid()
    )
  );

-- Public (unauthenticated) can read availability so the booking page
-- can filter dates and generate time slots without requiring a session.
CREATE POLICY "Public can view staff availability"
  ON public.staff_availability
  FOR SELECT
  USING (true);
