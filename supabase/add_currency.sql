-- add_currency.sql
-- Adds currency support to salons, plus custom title/intro and required-field
-- toggles to booking_pages.
--
-- All columns have safe defaults so existing rows are not affected.
-- Run once in the Supabase SQL editor.

-- Step 1: Display currency per salon (ISO 4217 code, e.g. 'USD', 'EUR').
ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Step 2: Custom heading and welcome message for the public booking page.
ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS custom_title TEXT;

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS custom_intro TEXT;

-- Step 3: Per-booking-page control over which contact fields are required.
-- Both default to true so existing salons continue to collect phone + email.
ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS require_phone BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS require_email BOOLEAN NOT NULL DEFAULT true;
