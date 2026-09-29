/**
 * lib/image-type.ts
 *
 * Detects the type of an uploaded image from its first bytes, so an upload is
 * accepted for what it is rather than for the type the browser declared.
 * Recognised: JPEG, PNG and WebP, the formats staff photos may use.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

/** Image types accepted for staff photos. */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** File extension stored for each accepted type. */
export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

/** Returns true when `bytes` starts with `signature` at `offset`. */
function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Detects JPEG, PNG or WebP from a file's signature.
 *
 * @param bytes - The file's content (the first 12 bytes are enough).
 * @returns     The image type, or null when the content is none of them.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP: "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}
