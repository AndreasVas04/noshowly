-- Migration: add template columns to salons.
-- sms_template: legacy column (unused — product is email-only). Kept for compatibility.
-- email_footer: custom footer line for reminder emails. NULL = use app default.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS sms_template  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_footer  TEXT DEFAULT NULL;
