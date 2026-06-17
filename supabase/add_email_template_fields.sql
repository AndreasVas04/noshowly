-- Migration: customisable email template fields on salons.
-- NULL = use application default from lib/reminder-templates.ts.

ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_greeting TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_body     TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_closing  TEXT;
