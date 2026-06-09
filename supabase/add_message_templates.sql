-- Migration: add sms_template and email_footer columns to salons table
--
-- sms_template: fully customisable SMS reminder text with {variable} placeholders.
--   NULL means "use the application default from lib/reminder-templates.ts".
--
-- email_footer: custom footer line shown at the bottom of reminder emails.
--   NULL means "use the application default from lib/reminder-templates.ts".
--
-- Supported variables:
--   SMS:   {client_name}, {business_name}, {service}, {time}, {date}
--   Email: {business_name}
--
-- Run this in the Supabase SQL editor or via the CLI.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS sms_template  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_footer  TEXT DEFAULT NULL;
