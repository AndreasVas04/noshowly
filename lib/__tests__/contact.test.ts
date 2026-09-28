/**
 * lib/__tests__/contact.test.ts
 *
 * Unit tests for phone normalisation, the phone lookup pattern and email
 * validation in lib/contact.ts, plus client field validation and the name
 * rule used for client de-duplication in lib/clients.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PHONE_INPUT_LENGTH,
  looksLikePhone,
  normalisePhone,
  phoneMatchPattern,
  validateEmail,
  validatePhone,
} from '@/lib/contact';
import { namesMatch, parseClientFields } from '@/lib/clients';

describe('normalisePhone', () => {
  it('strips spaces, dashes, dots and parentheses and keeps the leading +', () => {
    expect(normalisePhone('+357 99 123 456')).toBe('+35799123456');
    expect(normalisePhone(' (+357) 99-123.456 ')).toBe('+35799123456');
    expect(normalisePhone('+1 (555) 010-0199')).toBe('+15550100199');
    expect(normalisePhone('99123456')).toBe('99123456');
  });
});

describe('validatePhone', () => {
  it('returns the normalised number', () => {
    expect(validatePhone('+357 99 123 456')).toEqual({ ok: true, value: '+35799123456' });
  });

  it('requires a country code', () => {
    expect(validatePhone('99 123 456').ok).toBe(false);
  });

  it('rejects letters, too few or too many digits and long input', () => {
    expect(validatePhone('+357 99 CALL ME').ok).toBe(false);
    expect(validatePhone('+123').ok).toBe(false);
    expect(validatePhone('+1234567890123456').ok).toBe(false);
    expect(validatePhone(`+357${' '.repeat(MAX_PHONE_INPUT_LENGTH)}99123456`).ok).toBe(false);
  });
});

describe('phoneMatchPattern', () => {
  /** Postgres AREs and JavaScript agree on this small subset of regex syntax. */
  const matches = (pattern: string, value: string) => new RegExp(pattern).test(value);

  it('matches a number stored with or without separators', () => {
    const pattern = phoneMatchPattern('+35799123456', { exact: true });
    expect(matches(pattern, '+35799123456')).toBe(true);
    expect(matches(pattern, '+357 99 123 456')).toBe(true);
    expect(matches(pattern, '(+357) 99-123-456')).toBe(true);
  });

  it('does not match other numbers', () => {
    const pattern = phoneMatchPattern('+35799123456', { exact: true });
    expect(matches(pattern, '+357991234567')).toBe(false);
    expect(matches(pattern, '+3579912345')).toBe(false);
    expect(matches(pattern, '+357 99 123 457')).toBe(false);
    expect(matches(pattern, '35799123456')).toBe(false);
  });

  it('finds fragments anywhere when not exact', () => {
    const pattern = phoneMatchPattern(normalisePhone('99 123'), { exact: false });
    expect(matches(pattern, '+357 99 123 456')).toBe(true);
    expect(matches(pattern, '+35799123456')).toBe(true);
    expect(matches(pattern, '+357 91 923 456')).toBe(false);
  });

  it('escapes the plus sign', () => {
    expect(phoneMatchPattern('+1', { exact: false })).toBe('\\+[ ().-]*1');
  });
});

describe('looksLikePhone', () => {
  it('detects phone-like search terms', () => {
    expect(looksLikePhone('+357 99')).toBe(true);
    expect(looksLikePhone('99-12')).toBe(true);
    expect(looksLikePhone('Anna')).toBe(false);
    expect(looksLikePhone('Anna 2')).toBe(false);
    expect(looksLikePhone('+')).toBe(false);
  });
});

describe('validateEmail', () => {
  it('accepts and trims valid addresses', () => {
    expect(validateEmail(' jane@example.com ')).toEqual({ ok: true, value: 'jane@example.com' });
  });

  it('rejects malformed or overly long addresses', () => {
    expect(validateEmail('jane@example').ok).toBe(false);
    expect(validateEmail('jane example@x.com').ok).toBe(false);
    expect(validateEmail('@example.com').ok).toBe(false);
    expect(validateEmail(`${'a'.repeat(250)}@example.com`).ok).toBe(false);
  });
});

describe('namesMatch', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(namesMatch(' Jane Smith', 'jane smith ')).toBe(true);
    expect(namesMatch('Jane Smith', 'John Smith')).toBe(false);
  });
});

describe('parseClientFields', () => {
  it('requires name and phone when creating and normalises the phone', () => {
    expect(parseClientFields({ name: ' Jane ', phone: '+357 99 123 456' }, 'create')).toEqual({
      ok: true,
      fields: { name: 'Jane', phone: '+35799123456' },
    });
    expect(parseClientFields({ name: 'Jane' }, 'create').ok).toBe(false);
    expect(parseClientFields({ phone: '+35799123456' }, 'create').ok).toBe(false);
  });

  it('only includes supplied fields when updating and allows clearing', () => {
    expect(parseClientFields({ email: 'jane@example.com' }, 'update')).toEqual({
      ok: true,
      fields: { email: 'jane@example.com' },
    });
    expect(parseClientFields({ phone: null, notes: '' }, 'update')).toEqual({
      ok: true,
      fields: { phone: null, notes: null },
    });
    expect(parseClientFields({}, 'update').ok).toBe(false);
  });

  it('rejects invalid values', () => {
    expect(parseClientFields({ name: '' }, 'update').ok).toBe(false);
    expect(parseClientFields({ name: 'x'.repeat(101) }, 'update').ok).toBe(false);
    expect(parseClientFields({ email: 'not-an-email' }, 'update').ok).toBe(false);
    expect(parseClientFields({ notes: 'x'.repeat(501) }, 'update').ok).toBe(false);
    expect(parseClientFields({ phone: 12345 }, 'update').ok).toBe(false);
  });
});
