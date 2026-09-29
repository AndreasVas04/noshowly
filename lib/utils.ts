/**
 * lib/utils.ts
 *
 * Small helpers shared by components.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves conflicting Tailwind classes (the last one wins).
 *
 * @param inputs - Class names, arrays and conditional objects.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Returns the initials of a name for an avatar: the first letters of the
 * first and last words, or the first two letters of a single word.
 *
 * @param name - Display name.
 * @returns    Up to two capital letters, or '?' when the name is empty.
 *
 * @example getInitials('Elena Georgiou') // 'EG'
 * @example getInitials('John')           // 'JO'
 */
export function getInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Returns the message to show for a failed API response: the `error` field of
 * its JSON body, or the fallback when the body has none or is not JSON (for
 * example a gateway error page).
 *
 * @param res      - The response, with ok === false.
 * @param fallback - Message used when the response carries none.
 */
export async function responseError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === 'string' && data.error.trim() !== '' ? data.error : fallback;
}
