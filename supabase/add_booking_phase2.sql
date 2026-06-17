-- Migration: staff availability scheduling for online booking.
-- day_of_week: 0 = Sunday .. 6 = Saturday (matches Date.getDay()).
-- Two optional time slots per day allow a split schedule (e.g. morning + afternoon).

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

ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

-- Owner policy: ownership traced via barber -> salon -> user.
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

-- Public read: booking page needs availability to generate time slots.
CREATE POLICY "Public can view staff availability"
  ON public.staff_availability
  FOR SELECT
  USING (true);
