-- Migration: services table for per-salon service catalogue.

CREATE TABLE IF NOT EXISTS services (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own services" ON services
  FOR ALL USING (
    salon_id IN (SELECT id FROM salons WHERE user_id = auth.uid())
  );
