-- Migration: add customisable email template fields to salons
-- Run this against your Supabase project before deploying the matching app update.

ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_greeting TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_body     TEXT;
ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS email_closing  TEXT;
