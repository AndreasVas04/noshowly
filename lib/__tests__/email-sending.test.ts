/**
 * lib/__tests__/email-sending.test.ts
 *
 * Unit tests for the parts of sending that do not need the network: the
 * app URL used for email links (lib/reminders/links.ts) and the From header
 * built from the salon name and RESEND_FROM_ADDRESS (lib/resend.ts).
 */

import { describe, expect, it } from 'vitest';
import { buildConfirmationLinks, resolveAppUrl } from '@/lib/reminders/links';
import { buildFromHeader, extractEmailAddress, sanitiseDisplayName } from '@/lib/resend';

describe('resolveAppUrl', () => {
  it('fails loudly when NEXT_PUBLIC_APP_URL is missing or not absolute', () => {
    for (const value of [undefined, null, '', '   ']) {
      const result = resolveAppUrl(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('NEXT_PUBLIC_APP_URL');
    }
    expect(resolveAppUrl('noshowly.vercel.app').ok).toBe(false);
    expect(resolveAppUrl('/relative').ok).toBe(false);
    expect(resolveAppUrl('ftp://noshowly.vercel.app').ok).toBe(false);
    expect(resolveAppUrl('https://noshowly.vercel.app/?x=1').ok).toBe(false);
  });

  it('returns the URL without a trailing slash', () => {
    expect(resolveAppUrl('https://noshowly.vercel.app/')).toEqual({ ok: true, url: 'https://noshowly.vercel.app' });
    expect(resolveAppUrl(' http://localhost:3000 ')).toEqual({ ok: true, url: 'http://localhost:3000' });
    expect(resolveAppUrl('https://example.com/app/')).toEqual({ ok: true, url: 'https://example.com/app' });
  });
});

describe('buildConfirmationLinks', () => {
  it('points both buttons at the confirmation page', () => {
    expect(buildConfirmationLinks('https://noshowly.vercel.app', 'abc-123')).toEqual({
      confirmUrl: 'https://noshowly.vercel.app/api/confirm/abc-123?response=yes',
      cancelUrl:  'https://noshowly.vercel.app/api/confirm/abc-123?response=no',
    });
  });

  it('encodes the token', () => {
    expect(buildConfirmationLinks('https://x.test', 'a/b?c').confirmUrl)
      .toBe('https://x.test/api/confirm/a%2Fb%3Fc?response=yes');
  });
});

describe('From header', () => {
  it('shows the salon name with the configured address', () => {
    expect(buildFromHeader('Salon Elena', 'reminders@noshowly.com')).toBe('"Salon Elena" <reminders@noshowly.com>');
  });

  it('uses only the address of a "Name <address>" setting', () => {
    expect(extractEmailAddress('Noshowly <reminders@noshowly.com>')).toBe('reminders@noshowly.com');
    expect(buildFromHeader('Salon Elena', 'Noshowly <reminders@noshowly.com>'))
      .toBe('"Salon Elena" <reminders@noshowly.com>');
  });

  it('falls back to the Resend test sender and to the bare address', () => {
    expect(buildFromHeader('Salon Elena', undefined)).toBe('"Salon Elena" <onboarding@resend.dev>');
    expect(buildFromHeader('  ', 'reminders@noshowly.com')).toBe('reminders@noshowly.com');
    expect(buildFromHeader(null, 'reminders@noshowly.com')).toBe('reminders@noshowly.com');
  });

  it('sanitises the salon name', () => {
    expect(sanitiseDisplayName('Salon "Elena"\r\nBcc: x@evil.test')).toBe('Salon Elena Bcc: xevil.test');
    expect(sanitiseDisplayName('<Hair & Co>')).toBe('Hair & Co');
    expect(sanitiseDisplayName('Back\\slash')).toBe('Backslash');
    expect(sanitiseDisplayName('Κομμωτήριο Έλενα')).toBe('Κομμωτήριο Έλενα');
    expect(sanitiseDisplayName('x'.repeat(100))).toHaveLength(70);
    expect(buildFromHeader('Salon\n"Elena" <admin@bank.test>', 'reminders@noshowly.com'))
      .toBe('"Salon Elena adminbank.test" <reminders@noshowly.com>');
  });
});
