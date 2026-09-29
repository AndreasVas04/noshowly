/**
 * lib/__tests__/image-type.test.ts
 *
 * Unit tests for detectImageType() in lib/image-type.ts: JPEG, PNG and WebP
 * are recognised from their signatures, and anything else is rejected,
 * whatever it claims to be.
 */

import { describe, expect, it } from 'vitest';
import { detectImageType, IMAGE_EXTENSIONS } from '@/lib/image-type';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP signatures', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png');
    const webp = new Uint8Array([...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBPVP8 ')]);
    expect(detectImageType(webp)).toBe('image/webp');
  });

  it('rejects other content', () => {
    expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(ascii('<!DOCTYPE html><html></html>'))).toBeNull();
    expect(detectImageType(ascii('GIF89a......'))).toBeNull();
    expect(detectImageType(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBeNull();
  });

  it('rejects files too short to carry a signature', () => {
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectImageType(ascii('RIFF1234WEB'))).toBeNull();
  });

  it('has a file extension for every accepted type', () => {
    expect(IMAGE_EXTENSIONS).toEqual({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
  });
});
