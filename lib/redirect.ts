/**
 * lib/redirect.ts
 *
 * Validates the `next` parameter that auth routes redirect to after signing a
 * user in. Only a path on this site is accepted: anything that a browser
 * could resolve to another origin ("//evil.example", "/\\evil.example",
 * "https://evil.example", ".evil.example" appended to the origin, …) falls
 * back to a default path, so the routes cannot be used as an open redirect.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

/** Base used to resolve a candidate path; only its origin matters. */
const PROBE_ORIGIN = 'https://noshowly.invalid';

/**
 * Returns the path to redirect to after an auth callback.
 *
 * Accepted: a path starting with a single "/" (with an optional query string
 * and fragment) that stays on this site. Rejected: missing values, absolute
 * or protocol-relative URLs, backslashes and control characters.
 *
 * @param value    - The requested path, e.g. the `next` query parameter.
 * @param fallback - Path used when the value is missing or not acceptable.
 * @returns        A path beginning with "/", safe to append to the site origin.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (typeof value !== 'string' || value === '') return fallback;
  // Browsers treat "\" like "/" and ignore tabs and newlines in URLs.
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
