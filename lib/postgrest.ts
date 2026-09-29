/**
 * lib/postgrest.ts
 *
 * Checks and escaping for values that go into Supabase (PostgREST) filters.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

/** A UUID in its canonical text form, any case. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true for a UUID. Ids from requests are checked with it so a
 * malformed id is rejected before it reaches the database, where it would be
 * an error rather than "not found".
 *
 * @param value - Candidate id.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Escapes LIKE wildcards (\, % and _) so an ilike filter matches the value literally.
 *
 * @param value - Text to match.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
