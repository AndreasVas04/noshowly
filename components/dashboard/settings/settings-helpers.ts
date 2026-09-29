/**
 * components/dashboard/settings/settings-helpers.ts
 *
 * Pure helpers of the Settings page (app/dashboard/settings/page.tsx):
 *  - the timezones offered in the timezone select;
 *  - the checks run before the business info and business hours sections save;
 *  - inserting a template variable at the cursor of a template field;
 *  - the sample values of the live reminder email preview.
 *
 * No React and no requests: everything here is covered by unit tests in
 * __tests__/settings-helpers.test.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Save state of a section, shown by SaveIndicator in the section header. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Sample template variables of the reminder email preview. */
type PreviewVariables = {
  client_name: string;
  business_name: string;
  service: string;
  time: string;
  date: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timezones offered in the timezone select. */
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Halifax',
  'America/St_Johns',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Athens',
  'Europe/Nicosia',
  'Europe/Riga',
  'Europe/Tallinn',
  'Europe/Vilnius',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Pacific/Auckland',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the timezones offered in the timezone select. The salon's current
 * timezone is always listed, even when it is not a common one (it then comes
 * first).
 *
 * @param timezone - The salon's current timezone.
 * @returns        Timezone names in display order.
 */
export function timezoneOptions(timezone: string): readonly string[] {
  return (COMMON_TIMEZONES as readonly string[]).includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];
}

/**
 * Checks the business name before the business info section saves.
 *
 * @param trimmedName - Business name without surrounding whitespace.
 * @returns           The error to show, or null when the name can be saved.
 */
export function salonNameError(trimmedName: string): string | null {
  if (!trimmedName) return 'Business name is required.';
  if (trimmedName.length > 100) return 'Business name must be 100 characters or fewer.';
  return null;
}

/**
 * Checks the business hours before the business hours section saves. Either
 * time may be empty; the range is only checked when both are set.
 *
 * @param open  - Opening time (HH:MM or empty).
 * @param close - Closing time (HH:MM or empty).
 * @returns     The error to show, or null when the hours can be saved.
 */
export function businessHoursError(open: string, close: string): string | null {
  if (open && close && open >= close) return 'Closing time must be after opening time.';
  return null;
}

/**
 * Inserts a template variable into a field's text, replacing the selected
 * range (or at the cursor when nothing is selected).
 *
 * @param value    - Current text of the field.
 * @param start    - Selection start (cursor position); clamped to the text.
 * @param end      - Selection end; clamped to [start, text length].
 * @param variable - Variable to insert, e.g. "{client_name}".
 * @returns        The new text, and the cursor position just after the variable.
 */
export function insertVariable(
  value: string,
  start: number,
  end: number,
  variable: string,
): { value: string; cursor: number } {
  const from = Math.min(Math.max(0, start), value.length);
  const to   = Math.min(Math.max(from, end), value.length);
  return {
    value:  value.slice(0, from) + variable + value.slice(to),
    cursor: from + variable.length,
  };
}

/**
 * Sample values used in the reminder preview.
 *
 * @param salonName - Business name as typed; blank → "Your Business".
 * @returns         Template variables for applyTemplate() (lib/reminder-templates.ts).
 */
export function previewVariables(salonName: string): PreviewVariables {
  return {
    client_name:   'John',
    business_name: salonName.trim() || 'Your Business',
    service:       'Haircut',
    time:          '10:30',
    date:          'Tuesday 16 June',
  };
}
