/**
 * lib/cron-auth.ts
 *
 * Authenticates scheduled job requests (app/api/cron/*) with CRON_SECRET.
 *
 * The secret is accepted from either header:
 *  - Authorization: Bearer <CRON_SECRET> — sent by Vercel Cron (GET);
 *  - X-Cron-Secret: <CRON_SECRET>        — sent by the Supabase pg_cron job (POST).
 * Every request is rejected while CRON_SECRET is not set.
 *
 * Secrets are compared with crypto.timingSafeEqual over their SHA-256 digests:
 * the inputs always have the same length whatever the secret lengths, and the
 * comparison takes the same time however much of a guess is right.
 *
 * Server-only (node:crypto); no imports from Next.js or Supabase.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** Result of authorizeCronRequest(). */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing' | 'mismatch' };

/**
 * Compares two secrets in constant time.
 *
 * @param provided - Secret from the request.
 * @param expected - Configured secret.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Reads the secret a request carries: the Bearer token of the Authorization
 * header, otherwise the X-Cron-Secret header.
 *
 * @param headers - Request headers.
 * @returns       The secret, or null when the request carries none.
 */
export function readCronSecret(headers: Headers): string | null {
  const authorization = headers.get('authorization');
  const bearer = authorization ? /^Bearer +(\S+)$/i.exec(authorization.trim()) : null;
  if (bearer) return bearer[1];
  return headers.get('x-cron-secret') || null;
}

/**
 * Checks a scheduled job request against CRON_SECRET.
 *
 * @param headers  - Request headers.
 * @param expected - Configured secret (defaults to process.env.CRON_SECRET).
 */
export function authorizeCronRequest(
  headers: Headers,
  expected: string | undefined = process.env.CRON_SECRET,
): CronAuthResult {
  if (!expected) return { ok: false, reason: 'not_configured' };
  const provided = readCronSecret(headers);
  if (!provided) return { ok: false, reason: 'missing' };
  return secretsMatch(provided, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
