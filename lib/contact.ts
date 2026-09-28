/**
 * lib/contact.ts
 *
 * Validation and normalisation of client contact details (phone and email).
 *
 * Phone numbers are stored normalised (country code, digits only, e.g.
 * '+35799123456') so the same number is always recognised. Older rows may
 * still be stored as typed ('+357 99 123 456'); phoneMatchPattern() builds a
 * Postgres regular expression that finds a number in either form.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

/** Longest phone input accepted from a form, before normalisation. */
export const MAX_PHONE_INPUT_LENGTH = 30;

/** Longest email address accepted (RFC 5321 path limit). */
export const MAX_EMAIL_LENGTH = 254;

/** Separator characters people type inside phone numbers. */
const SEPARATOR_CHARS = /[\s\-.()]/g;

/** Postgres regex fragment matching any run of the separators above. */
const SEPARATOR_PATTERN = '[ ().-]*';

/** Loose email shape check: something@domain.tld, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Result of validatePhone() and validateEmail(). */
export type ContactValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/**
 * Normalises a phone number: trims it and removes spaces, dashes, dots and
 * parentheses. A leading '+' is kept.
 *
 * @param raw - Phone number as typed.
 * @returns   Normalised number, e.g. '+357 (99) 123-456' → '+35799123456'.
 */
export function normalisePhone(raw: string): string {
  return raw.trim().replace(SEPARATOR_CHARS, '');
}

/**
 * Validates a client phone number from a form and returns it normalised.
 * The number must include a country code ('+') followed by 5–15 digits.
 *
 * @param raw - Phone number as typed.
 * @returns   The normalised number, or a user-facing error.
 */
export function validatePhone(raw: string): ContactValidation {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_PHONE_INPUT_LENGTH) {
    return { ok: false, error: `Phone number must be ${MAX_PHONE_INPUT_LENGTH} characters or fewer` };
  }
  const phone = normalisePhone(trimmed);
  if (!phone.startsWith('+')) {
    return { ok: false, error: 'Phone must include country code (e.g. +357 99 123 456)' };
  }
  if (!/^\+\d{5,15}$/.test(phone)) {
    return { ok: false, error: 'Enter a valid phone number, e.g. +357 99 123 456' };
  }
  return { ok: true, value: phone };
}

/**
 * Returns true when a search term looks like (part of) a phone number:
 * digits, '+' and separators only, with at least one digit.
 *
 * @param term - Search input.
 */
export function looksLikePhone(term: string): boolean {
  return /\d/.test(term) && /^[+\d\s\-.()]+$/.test(term.trim());
}

/** Escapes characters that have a meaning in regular expressions. */
function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Builds a Postgres regular expression (for PostgREST's `match` operator)
 * that finds a phone number whether it was stored normalised or with
 * separators, e.g. '+35799123456' also matches '+357 99 123 456' and
 * '(+357) 99-123-456'. Only separators may appear between the characters, so
 * other numbers never match.
 *
 * @param phone         - Normalised phone number, or a normalised fragment of one.
 * @param options.exact - true: the whole stored value must be this number
 *                        (de-duplication); false: the number may appear
 *                        anywhere in the stored value (search as you type).
 * @returns             Regular expression source.
 */
export function phoneMatchPattern(phone: string, options: { exact: boolean }): string {
  const body = [...phone].map(escapeRegex).join(SEPARATOR_PATTERN);
  return options.exact ? `^${SEPARATOR_PATTERN}${body}${SEPARATOR_PATTERN}$` : body;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Validates an email address from a form and returns it trimmed.
 *
 * @param raw - Email as typed.
 * @returns   The trimmed email, or a user-facing error.
 */
export function validateEmail(raw: string): ContactValidation {
  const email = raw.trim();
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: `Email must be ${MAX_EMAIL_LENGTH} characters or fewer` };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  return { ok: true, value: email };
}
