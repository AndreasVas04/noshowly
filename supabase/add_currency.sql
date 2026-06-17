-- Migration: currency, custom booking page fields, and required-field toggles.

ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS custom_title TEXT;

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS custom_intro TEXT;

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS require_phone BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.booking_pages
  ADD COLUMN IF NOT EXISTS require_email BOOLEAN NOT NULL DEFAULT true;
