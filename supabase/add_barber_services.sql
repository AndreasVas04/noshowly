-- Migration: add_barber_services.sql
--
-- Creates the barber_services table linking salon-level services to specific
-- barbers. Used by the dashboard appointment modal to filter which staff
-- members can perform each service, and to validate appointments server-side.
--
-- IMPORTANT: This is separate from staff_services (per-barber public-booking
-- services with free-text names). barber_services uses FKs to the services
-- table (salon-level services) to enable structured filtering.
--
-- Backwards compatible: when no barber_services rows exist for a service,
-- all barbers are available (no restriction). Validation only activates once
-- at least one assignment is made for a service.

CREATE TABLE IF NOT EXISTS barber_services (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES salons(id)   ON DELETE CASCADE,
  barber_id  UUID        NOT NULL REFERENCES barbers(id)  ON DELETE CASCADE,
  service_id UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (barber_id, service_id)
);

-- Enable Row Level Security — enforced at DB level in addition to API route checks.
ALTER TABLE barber_services ENABLE ROW LEVEL SECURITY;

-- Owner can read their own salon's barber_services.
CREATE POLICY "Owner can read barber_services"
  ON barber_services FOR SELECT
  USING (
    salon_id IN (
      SELECT id FROM salons WHERE user_id = auth.uid()
    )
  );

-- Owner can insert/update/delete their own salon's barber_services.
CREATE POLICY "Owner can manage barber_services"
  ON barber_services FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM salons WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    salon_id IN (
      SELECT id FROM salons WHERE user_id = auth.uid()
    )
  );
