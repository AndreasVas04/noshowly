-- supabase/add_services_table.sql
--
-- Creates the services table so each salon can define their own list of
-- service names (e.g. "Haircut", "Beard trim", "Hair colour", "Massage").
-- Services appear as a dropdown when the salon owner adds an appointment.
--
-- Pattern matches the barbers table: id, salon_id, name, created_at.
-- RLS policy mirrors barbers: salon owners can only access their own services.
--
-- Run this in the Supabase SQL editor once.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS services (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Salon owners can only read and write services that belong to their own salon.
CREATE POLICY "Users own services" ON services
  FOR ALL USING (
    salon_id IN (SELECT id FROM salons WHERE user_id = auth.uid())
  );
