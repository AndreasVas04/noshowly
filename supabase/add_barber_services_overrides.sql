-- Migration: per-staff price and duration overrides on barber_services.
-- NULL = use the global service default.

ALTER TABLE barber_services
  ADD COLUMN IF NOT EXISTS price_override DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes_override INTEGER NULL;
