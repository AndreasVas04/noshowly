-- The public demo account's password and email cannot be changed (trigger
-- from 20260928120000_security_hardening.sql). Runs as the database user the
-- tests connect as, which owns auth.users like Supabase Auth does.

BEGIN;

DO $$
BEGIN
  PERFORM tests.expect_error('demo: change password', '42501',
    $s$UPDATE auth.users SET encrypted_password = 'new-hash' WHERE email = 'demo@noshowly.com'$s$);
  PERFORM tests.expect_error('demo: change email', '42501',
    $s$UPDATE auth.users SET email = 'attacker@example.test' WHERE email = 'demo@noshowly.com'$s$);
  PERFORM tests.expect_error('demo: change email case', '42501',
    $s$UPDATE auth.users SET email = 'DEMO@noshowly.com' WHERE email = 'demo@noshowly.com'$s$);

  -- Signing in still updates the row.
  PERFORM tests.expect_changed('demo: sign-in timestamp', 1,
    $s$UPDATE auth.users SET last_sign_in_at = now() WHERE email = 'demo@noshowly.com'$s$);

  -- Other accounts are not affected.
  PERFORM tests.expect_changed('owner A: change password', 1, format(
    $s$UPDATE auth.users SET encrypted_password = 'new-hash' WHERE id = %L$s$, tests.id('owner_a')));
  PERFORM tests.expect_changed('owner A: change email', 1, format(
    $s$UPDATE auth.users SET email = 'new-a@example.test' WHERE id = %L$s$, tests.id('owner_a')));
END $$;

ROLLBACK;
