-- Migration: barber_services linking salon-level services to specific staff.
-- Used by the appointment modal to filter staff per service and for server-side validation.
-- Backwards compatible: no rows for a service = all staff available.

CREATE TABLE IF NOT EXISTS barber_services (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES salons(id)   ON DELETE CASCADE,
  barber_id  UUID        NOT NULL REFERENCES barbers(id)  ON DELETE CASCADE,
  service_id UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (barber_id, service_id)
);

ALTER TABLE barber_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read barber_services"
  ON barber_services FOR SELECT
  USING (
    salon_id IN (SELECT id FROM salons WHERE user_id = auth.uid())
  );

CREATE POLICY "Owner can manage barber_services"
  ON barber_services FOR ALL
  USING (
    salon_id IN (SELECT id FROM salons WHERE user_id = auth.uid())
  )
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE user_id = auth.uid())
  );
