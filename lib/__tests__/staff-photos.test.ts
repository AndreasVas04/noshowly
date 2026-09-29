/**
 * lib/__tests__/staff-photos.test.ts
 *
 * Unit tests for isOwnStaffPhotoUrl (lib/staff-photos.ts): a staff photo URL
 * must be a file in the owner's own folder of the staff photo bucket, on this
 * Supabase project.
 */

import { describe, expect, it } from 'vitest';
import { isOwnStaffPhotoUrl } from '@/lib/staff-photos';

const PROJECT = 'https://abcd.supabase.co';
const OWNER = '6f1c2b3a-1111-4222-8333-444455556666';
const OTHER = '0a9b8c7d-aaaa-4bbb-8ccc-dddddddddddd';
const FOLDER = `${PROJECT}/storage/v1/object/public/staff-photos/${OWNER}`;

describe('isOwnStaffPhotoUrl', () => {
  it('accepts a file the upload route wrote for this owner', () => {
    expect(isOwnStaffPhotoUrl(`${FOLDER}/1790680000000-k3j9x2.jpg`, PROJECT, OWNER)).toBe(true);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/1790680000000-k3j9x2.webp`, `${PROJECT}/`, OWNER)).toBe(true);
  });

  it('works with a local project URL', () => {
    const local = 'http://127.0.0.1:54321';
    expect(isOwnStaffPhotoUrl(`${local}/storage/v1/object/public/staff-photos/${OWNER}/a.png`, local, OWNER)).toBe(true);
  });

  it("rejects another site, even with the bucket's path", () => {
    expect(isOwnStaffPhotoUrl(`https://example.com/storage/v1/object/public/staff-photos/${OWNER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`http://abcd.supabase.co/storage/v1/object/public/staff-photos/${OWNER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`https://abcd.supabase.co.evil.test/storage/v1/object/public/staff-photos/${OWNER}/a.jpg`, PROJECT, OWNER)).toBe(false);
  });

  it("rejects another owner's folder, other buckets and paths that climb out", () => {
    expect(isOwnStaffPhotoUrl(`${PROJECT}/storage/v1/object/public/staff-photos/${OTHER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${PROJECT}/storage/v1/object/public/avatars/${OWNER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/../${OTHER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/%2e%2e/${OTHER}/a.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/sub/a.jpg`, PROJECT, OWNER)).toBe(false);
  });

  it('rejects the folder itself, odd file names, queries, fragments and credentials', () => {
    expect(isOwnStaffPhotoUrl(`${FOLDER}/`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/.hidden`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/a%20b.jpg`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/a.jpg?download=1`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/a.jpg#x`, PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(FOLDER.replace('https://', 'https://user:pw@') + '/a.jpg', PROJECT, OWNER)).toBe(false);
  });

  it('rejects values that are not URLs, and a missing owner', () => {
    expect(isOwnStaffPhotoUrl('not a url', PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl('javascript:alert(1)', PROJECT, OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${FOLDER}/a.jpg`, 'not a url', OWNER)).toBe(false);
    expect(isOwnStaffPhotoUrl(`${PROJECT}/storage/v1/object/public/staff-photos//a.jpg`, PROJECT, '')).toBe(false);
  });
});
