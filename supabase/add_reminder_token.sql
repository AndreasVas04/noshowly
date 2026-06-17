-- Migration: add single-use token column to reminders.
-- Used by email confirmation flow: token embedded in YES/NO button URLs.

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS token TEXT UNIQUE;

-- Fast lookup for /api/confirm/[token]. Partial index excludes NULL tokens.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_token
  ON public.reminders (token)
  WHERE token IS NOT NULL;
