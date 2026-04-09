-- =============================================================================
-- Migration: add token column to reminders table
-- =============================================================================
-- Adds a unique, single-use token to each reminder row.
-- Used by the email confirmation flow: the token is embedded in the YES/NO
-- button URLs so the client can confirm or cancel without logging in.
--
-- The token is also generated for SMS reminders (for consistency) but is not
-- used in the SMS template — SMS confirmations go through the Twilio webhook.
--
-- Run in: Supabase SQL Editor → New query → paste → Run
-- Safe to re-run: ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent.
-- =============================================================================

-- Add the token column — nullable TEXT, unique across all rows.
-- NULL is allowed because existing reminder rows (created before this migration)
-- do not have a token. New reminders always include a token (enforced in code).
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS token TEXT UNIQUE;

-- Index for fast token lookup in the /api/confirm/[token] route.
-- This endpoint is called by end clients clicking the email YES/NO button,
-- so the lookup must be fast even under load.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_token
  ON public.reminders (token)
  WHERE token IS NOT NULL;

-- =============================================================================
-- DONE
-- After running this script:
--  1. Confirm the `token` column appears in the reminders table.
--  2. Confirm the unique index exists.
--  3. No existing data is modified — all existing rows will have token = NULL.
-- =============================================================================
