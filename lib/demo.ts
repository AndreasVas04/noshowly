/**
 * lib/demo.ts
 *
 * The public demo account. Its credentials are in the README and on the login
 * page, so anyone can sign in to it. Account deletion is blocked for it in
 * /api/account, billing in /api/stripe/checkout and /api/stripe/portal (a
 * visitor must not be able to subscribe it or cancel its plan), and the
 * security_hardening migration in supabase/migrations/ blocks password and
 * email changes at the database level.
 */

export const DEMO_ACCOUNT_EMAIL = 'demo@noshowly.com';

/** Returns true when the email belongs to the public demo account. */
export function isDemoAccount(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}
