/**
 * lib/__tests__/postgrest.test.ts
 *
 * Unit tests for the query input helpers in lib/postgrest.ts.
 */

import { describe, expect, it } from 'vitest';
import { escapeLike, isUuid } from '@/lib/postgrest';

describe('isUuid', () => {
  it('accepts UUIDs in any case', () => {
    expect(isUuid('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true);
    expect(isUuid('3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('3f2b8c1e9a4d4e6f8b2a1c3d5e7f9a0b')).toBe(false);
    expect(isUuid(' 3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(false);
    expect(isUuid('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b,other')).toBe(false);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and backslashes', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });

  it('leaves other text alone', () => {
    expect(escapeLike('Jane.Doe+test@example.com')).toBe('Jane.Doe+test@example.com');
  });
});
