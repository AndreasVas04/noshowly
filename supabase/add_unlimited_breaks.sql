-- Migration: add_unlimited_breaks.sql
--
-- Adds a time_slots JSONB column to staff_availability so each day can have
-- an unlimited number of time slots (not just 2).
--
-- Format of time_slots: [{"start": "09:00", "end": "13:00"}, {"start": "14:00", "end": "18:00"}]
--
-- The existing start_time_1/end_time_1/start_time_2/end_time_2 columns are
-- kept for backwards compatibility but time_slots is the primary source of truth
-- going forward. New writes populate time_slots; reads prefer time_slots and
-- fall back to the legacy columns.

ALTER TABLE public.staff_availability
  ADD COLUMN IF NOT EXISTS time_slots JSONB DEFAULT '[]'::jsonb;

-- Add a check constraint to ensure time_slots is always a JSON array.
ALTER TABLE public.staff_availability
  ADD CONSTRAINT staff_availability_time_slots_is_array
  CHECK (jsonb_typeof(time_slots) = 'array');

-- Also add allow_no_preference columns to booking_pages for Step 5.
ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS allow_no_preference_staff    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_no_preference_service  BOOLEAN NOT NULL DEFAULT false;
