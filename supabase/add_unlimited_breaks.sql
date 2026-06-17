-- Migration: JSONB time_slots column for unlimited break slots per day.
-- Primary source of truth; legacy start_time_1/2 and end_time_1/2 kept for compatibility.
-- Format: [{"start": "09:00", "end": "13:00"}, {"start": "14:00", "end": "18:00"}]

ALTER TABLE public.staff_availability
  ADD COLUMN IF NOT EXISTS time_slots JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.staff_availability
  ADD CONSTRAINT staff_availability_time_slots_is_array
  CHECK (jsonb_typeof(time_slots) = 'array');

-- "No preference" toggles for the booking page step flow.
ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS allow_no_preference_staff    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_no_preference_service  BOOLEAN NOT NULL DEFAULT false;
