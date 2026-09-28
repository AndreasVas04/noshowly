/**
 * lib/reminders/links.ts
 *
 * Absolute links to the confirmation page (/api/confirm/[token]) for emails.
 *
 * Emails are opened outside the app, so their links must be absolute. They are
 * built from NEXT_PUBLIC_APP_URL; when it is missing or not an absolute
 * http(s) URL the email is not sent and an error is logged, instead of
 * sending links that go nowhere.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import type { ConfirmationLinks } from '@/lib/reminder-templates';

/** Result of resolveAppUrl(). */
export type AppUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validates the app's public base URL (NEXT_PUBLIC_APP_URL).
 *
 * @param raw - The configured value.
 * @returns   The URL without a trailing slash (e.g. 'https://noshowly.vercel.app'),
 *            or why it cannot be used.
 */
export function resolveAppUrl(raw: string | undefined | null): AppUrlResult {
  const value = raw?.trim();
  if (!value) {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL is not set; email links cannot be built' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL is not an absolute URL; email links cannot be built' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL must start with https:// or http://' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: 'NEXT_PUBLIC_APP_URL must not contain a query string or fragment' };
  }

  return { ok: true, url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

/**
 * Builds the YES/NO links of an email. Both open the confirmation page, which
 * only changes the appointment when the client presses a button there.
 *
 * @param appUrl - Base URL from resolveAppUrl().
 * @param token  - The reminder row's token.
 */
export function buildConfirmationLinks(appUrl: string, token: string): ConfirmationLinks {
  const page = `${appUrl}/api/confirm/${encodeURIComponent(token)}`;
  return {
    confirmUrl: `${page}?response=yes`,
    cancelUrl:  `${page}?response=no`,
  };
}
