-- Migration: add optional price and duration overrides to barber_services
-- These allow individual staff members to have different pricing/duration for the same service.
-- NULL means "use global service default".

ALTER TABLE barber_services
  ADD COLUMN IF NOT EXISTS price_override DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes_override INTEGER NULL;
