-- Migration: add confirmation toggle settings to salons
-- Controls whether reminders include a YES/NO confirmation request.
-- Both default to true (existing behaviour is preserved).

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS sms_confirmation_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS email_confirmation_enabled BOOLEAN NOT NULL DEFAULT true;
