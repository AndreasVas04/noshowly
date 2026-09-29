/**
 * lib/__tests__/demo.test.ts
 *
 * Unit tests for the public demo account helpers (lib/demo.ts).
 */

import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNT_EMAIL, DEMO_EMAIL_RECIPIENT, isDemoAccount } from '@/lib/demo';

describe('isDemoAccount', () => {
  it('recognises the demo sign-in address, ignoring case and spaces', () => {
    expect(isDemoAccount(DEMO_ACCOUNT_EMAIL)).toBe(true);
    expect(isDemoAccount('  Demo@Noshowly.com ')).toBe(true);
  });

  it('rejects every other address and a missing one', () => {
    expect(isDemoAccount('demo@noshowly.co')).toBe(false);
    expect(isDemoAccount('owner@example.com')).toBe(false);
    expect(isDemoAccount('')).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
    expect(isDemoAccount(undefined)).toBe(false);
  });
});

describe('DEMO_EMAIL_RECIPIENT', () => {
  it("is Resend's test inbox, not the demo sign-in address", () => {
    expect(DEMO_EMAIL_RECIPIENT).toBe('delivered@resend.dev');
    expect(DEMO_EMAIL_RECIPIENT).not.toBe(DEMO_ACCOUNT_EMAIL);
  });
});
