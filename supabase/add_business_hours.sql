-- add_business_hours.sql
--
-- Adds opening_time and closing_time columns to the salons table.
-- Run once in the Supabase SQL Editor after the initial schema is in place.
--
-- Both columns are nullable TIME (no timezone) — they store a clock time only,
-- not a full timestamp. NULL means the salon has not set business hours yet;
-- the app defaults to 06:00–23:00 in that case.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS opening_time TIME,
  ADD COLUMN IF NOT EXISTS closing_time TIME;

-- RLS on salons is already enabled via the "salons: owner all" policy created
-- in schema.sql. The new columns are covered by the existing policy — no
-- additional policy changes are needed.
