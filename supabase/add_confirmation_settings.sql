-- Migration: confirmation toggle settings on salons.
-- Controls whether email reminders include YES/NO confirmation buttons.
-- sms_confirmation_enabled: legacy column (unused — product is email-only). Kept for compatibility.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS sms_confirmation_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS email_confirmation_enabled BOOLEAN NOT NULL DEFAULT true;
