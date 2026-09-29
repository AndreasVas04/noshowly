/**
 * lib/__tests__/redirect.test.ts
 *
 * Unit tests for safeRedirectPath() in lib/redirect.ts: paths on this site
 * are kept, and every value a browser could send to another origin falls
 * back to the default.
 */

import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '@/lib/redirect';

describe('safeRedirectPath', () => {
  it('keeps a path on this site, with its query string and fragment', () => {
    expect(safeRedirectPath('/auth/reset-password')).toBe('/auth/reset-password');
    expect(safeRedirectPath('/dashboard/week?day=2026-10-05#top')).toBe('/dashboard/week?day=2026-10-05#top');
  });

  it('falls back when the value is missing or empty', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath(undefined)).toBe('/dashboard');
    expect(safeRedirectPath('')).toBe('/dashboard');
    expect(safeRedirectPath(null, '/login')).toBe('/login');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    for (const value of [
      'https://evil.example',
      'http://evil.example/dashboard',
      '//evil.example',
      '//evil.example/dashboard',
      'javascript:alert(1)',
      'evil.example',
    ]) {
      expect(safeRedirectPath(value), value).toBe('/dashboard');
    }
  });

  it('rejects values that only look like paths once appended to the origin', () => {
    for (const value of [
      '@evil.example',
      '.evil.example',
      ':8080/dashboard',
    ]) {
      expect(safeRedirectPath(value), value).toBe('/dashboard');
    }
  });

  it('rejects backslashes and control characters, which browsers normalise', () => {
    for (const value of [
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/%0a',
    ]) {
      const result = safeRedirectPath(value);
      expect(result.startsWith('//'), value).toBe(false);
      expect(result.startsWith('/'), value).toBe(true);
    }
    expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('/\t/evil.example')).toBe('/dashboard');
  });

  it('normalises dot segments without leaving the site', () => {
    expect(safeRedirectPath('/dashboard/../auth/reset-password')).toBe('/auth/reset-password');
    expect(safeRedirectPath('/../../evil')).toBe('/evil');
  });
});
