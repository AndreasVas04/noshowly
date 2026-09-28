/**
 * lib/__tests__/cron-auth.test.ts
 *
 * Unit tests for scheduled job authentication in lib/cron-auth.ts: constant-
 * time secret comparison, the two accepted headers, and rejection when
 * CRON_SECRET is not set.
 */

import { describe, expect, it } from 'vitest';
import { authorizeCronRequest, readCronSecret, secretsMatch } from '@/lib/cron-auth';

const SECRET = 's3cret-value-with-enough-entropy';

describe('secretsMatch', () => {
  it('matches equal secrets only', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretsMatch('S3CRET-VALUE-WITH-ENOUGH-ENTROPY', SECRET)).toBe(false);
  });

  it('handles different lengths and empty values without throwing', () => {
    expect(secretsMatch('', SECRET)).toBe(false);
    expect(secretsMatch('x'.repeat(10_000), SECRET)).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});

describe('readCronSecret', () => {
  it('reads a Bearer token (Vercel Cron) or X-Cron-Secret (pg_cron)', () => {
    expect(readCronSecret(new Headers({ Authorization: `Bearer ${SECRET}` }))).toBe(SECRET);
    expect(readCronSecret(new Headers({ authorization: `bearer ${SECRET}` }))).toBe(SECRET);
    expect(readCronSecret(new Headers({ 'X-Cron-Secret': SECRET }))).toBe(SECRET);
  });

  it('ignores other authorization schemes and empty headers', () => {
    expect(readCronSecret(new Headers({ Authorization: `Basic ${SECRET}` }))).toBeNull();
    expect(readCronSecret(new Headers({ Authorization: 'Bearer' }))).toBeNull();
    expect(readCronSecret(new Headers({ 'X-Cron-Secret': '' }))).toBeNull();
    expect(readCronSecret(new Headers())).toBeNull();
    expect(readCronSecret(new Headers({ Authorization: 'Basic abc', 'X-Cron-Secret': SECRET }))).toBe(SECRET);
  });
});

describe('authorizeCronRequest', () => {
  it('rejects every request while CRON_SECRET is not set', () => {
    const headers = new Headers({ Authorization: 'Bearer undefined' });
    expect(authorizeCronRequest(headers, undefined)).toEqual({ ok: false, reason: 'not_configured' });
    expect(authorizeCronRequest(new Headers({ 'X-Cron-Secret': '' }), '')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects requests without a secret or with a wrong one', () => {
    expect(authorizeCronRequest(new Headers(), SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(authorizeCronRequest(new Headers({ 'X-Cron-Secret': 'wrong' }), SECRET))
      .toEqual({ ok: false, reason: 'mismatch' });
    expect(authorizeCronRequest(new Headers({ Authorization: 'Bearer wrong' }), SECRET))
      .toEqual({ ok: false, reason: 'mismatch' });
  });

  it('accepts the secret from either header', () => {
    expect(authorizeCronRequest(new Headers({ Authorization: `Bearer ${SECRET}` }), SECRET)).toEqual({ ok: true });
    expect(authorizeCronRequest(new Headers({ 'X-Cron-Secret': SECRET }), SECRET)).toEqual({ ok: true });
  });
});
