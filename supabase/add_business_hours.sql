-- Migration: opening/closing time columns on salons.
-- Nullable TIME (clock time only). NULL = business hours not yet configured.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS opening_time TIME,
  ADD COLUMN IF NOT EXISTS closing_time TIME;
