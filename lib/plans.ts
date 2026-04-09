/**
 * lib/plans.ts
 *
 * Single source of truth for NoShowly's subscription plan configuration.
 *
 * Every part of the codebase that touches plan limits, reminder caps, or
 * geo-blocking MUST import from this file — never hardcode these values.
 *
 * Key decisions baked in here (see CLAUDE.md §5 for rationale):
 *  - Trial accounts can send email reminders only (0 SMS) — protects margin.
 *  - SMS is the primary reminder channel; email is optional/secondary.
 *  - Accounts from countries where SMS costs > $0.08/msg are blocked on signup.
 *  - Plan limits are based on realistic barber workload: ~200 appointments/barber/month.
 */

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

/**
 * Monthly SMS reminder cap per subscription plan.
 *
 * 'trial' is intentionally 0 — trial users receive email reminders only.
 * SMS is unlocked the moment a trial converts to any paid plan.
 *
 * Derivation (worst-case, fully booked):
 *  - 1 barber ≈ 9 appts/day × 5.5 days/week × 4.33 weeks ≈ 214 appts/month
 *  - ~80% of clients have phone numbers → ~171 SMS/barber/month
 *  - Solo (250): 1 barber + comfortable buffer
 *  - Salon (600): 2-4 barbers realistically
 *  - Studio (1200): 5-10 barbers realistically
 */
export const PLAN_LIMITS = {
  trial: 0,     // Email reminders only during trial — no SMS
  solo: 250,    // $29.99/month
  salon: 600,   // $49.99/month
  studio: 1200, // $89.99/month
} as const;

/**
 * Active subscription plan keys — derived from PLAN_LIMITS so the two stay
 * in sync automatically.  Does NOT include 'cancelled'.
 *
 * Use this type when enforcing limits or checking plan features.
 * Use UserPlan (below) when reading the `plan` column from the database.
 */
export type PlanType = keyof typeof PLAN_LIMITS;

/**
 * Full set of values the `users.plan` database column can hold.
 * Extends PlanType with 'cancelled' for accounts whose subscription has lapsed.
 *
 * Use this type in DB row shapes and anywhere the value comes from Supabase.
 */
export type UserPlan = PlanType | 'cancelled';

// ---------------------------------------------------------------------------
// Geo-blocking
// ---------------------------------------------------------------------------

/**
 * Maximum SMS cost (in USD) we accept for a signup region.
 * Countries where Twilio charges more than this per outbound SMS are blocked
 * at registration to protect margin.
 */
export const MAX_SMS_COST_USD = 0.08 as const;

/**
 * ISO 3166-1 alpha-2 country codes where Twilio SMS costs < $0.08/msg.
 * Signups from countries NOT in this list are blocked at registration.
 *
 * Includes: US, Canada, UK, Ireland, Australia, NZ, Japan, Singapore,
 * and all EU member states + EEA (Norway, Iceland, Liechtenstein) + Switzerland.
 *
 * Blocked examples: most of Africa, some Pacific islands, Afghanistan —
 * anywhere Twilio charges > $0.08/SMS outbound.
 */
export const ALLOWED_REGIONS = [
  // North America & Pacific
  'US', 'CA', 'AU', 'NZ', 'JP', 'SG',
  // UK & Ireland
  'GB', 'IE',
  // EU member states
  'CY', 'GR', 'DE', 'FR', 'ES', 'IT', 'PT', 'NL',
  'BE', 'AT', 'SE', 'DK', 'FI', 'PL', 'CZ',
  'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'EE', 'LV', 'LT',
  'LU', 'MT',
  // EEA (not EU but same SMS cost bracket)
  'NO', 'IS', 'LI',
  // Switzerland
  'CH',
] as const;

/** Union type of every allowed ISO country code. */
export type AllowedRegion = (typeof ALLOWED_REGIONS)[number];

// ---------------------------------------------------------------------------
// Reminder dispatch constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of reminders a single salon may send in any 60-minute window.
 * Exceeding this triggers an alert and blocks further sending for that window.
 * Protects against runaway cron jobs and misconfigured pg_cron schedules.
 */
export const HOURLY_REMINDER_RATE_LIMIT = 20 as const;

/**
 * Appointment time window (hours from now) that triggers an SMS reminder.
 * pg_cron runs every hour; any appointment falling in the [minHours, maxHours]
 * window gets an SMS. The 2-hour window absorbs cron jitter.
 */
export const SMS_REMINDER_WINDOW = { minHours: 23, maxHours: 25 } as const;

/**
 * Appointment time window (hours from now) that triggers an email reminder.
 * Email is sent 48 h before; the 2-hour window absorbs cron jitter.
 */
export const EMAIL_REMINDER_WINDOW = { minHours: 47, maxHours: 49 } as const;

// ---------------------------------------------------------------------------
// Plan utility functions
// ---------------------------------------------------------------------------

/**
 * Returns the monthly SMS reminder limit for a given plan.
 *
 * Returns 0 for 'cancelled' accounts — they cannot send any reminders.
 * Returns 0 for 'trial' accounts — they are email-only.
 *
 * @param plan - The user's current subscription plan.
 * @returns The maximum number of SMS reminders allowed per month.
 *
 * @example
 * getPlanSMSLimit('solo')      // → 250
 * getPlanSMSLimit('trial')     // → 0
 * getPlanSMSLimit('cancelled') // → 0
 */
export function getPlanSMSLimit(plan: UserPlan): number {
  if (plan === 'cancelled') return 0;
  return PLAN_LIMITS[plan];
}

/**
 * Returns true if the given plan allows SMS reminders to be sent.
 *
 * Only paid plans (solo, salon, studio) allow SMS.
 * Trial and cancelled accounts are SMS-blocked — trial to protect margin,
 * cancelled because the subscription has lapsed.
 *
 * @param plan - The user's current subscription plan.
 * @returns true if SMS reminders are permitted on this plan.
 *
 * @example
 * planAllowsSMS('solo')      // → true
 * planAllowsSMS('trial')     // → false  (email only)
 * planAllowsSMS('cancelled') // → false
 */
export function planAllowsSMS(plan: UserPlan): boolean {
  return plan !== 'trial' && plan !== 'cancelled';
}

/**
 * Returns true if the given plan is currently active (not cancelled or expired).
 *
 * An active plan can add appointments and send reminders (subject to channel
 * restrictions for trial accounts).
 *
 * @param plan - The user's current subscription plan.
 * @returns true if the plan is in an active state.
 */
export function isPlanActive(plan: UserPlan): boolean {
  return plan !== 'cancelled';
}

// ---------------------------------------------------------------------------
// Geo-blocking utility functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the given ISO 3166-1 alpha-2 country code is in the list of
 * regions where NoShowly is available.
 *
 * Comparison is case-insensitive — 'us', 'US', and 'Us' all return true.
 *
 * @param countryCode - A two-letter ISO country code (e.g. 'US', 'GB', 'CY').
 * @returns true if signups are allowed from this country.
 *
 * @example
 * isRegionAllowed('US')  // → true
 * isRegionAllowed('cy')  // → true  (Cyprus — case-insensitive)
 * isRegionAllowed('NG')  // → false (Nigeria — SMS too expensive)
 */
export function isRegionAllowed(countryCode: string): boolean {
  return (ALLOWED_REGIONS as readonly string[]).includes(
    countryCode.toUpperCase()
  );
}

/**
 * Returns a user-facing message explaining why their region is not supported.
 * Used on the registration page when geo-blocking fires.
 *
 * The message deliberately avoids technical language and stays constructive.
 *
 * @returns A human-readable, non-technical "not available" message.
 */
export function getRegionBlockedMessage(): string {
  return (
    "NoShowly isn't available in your region yet. " +
    'We currently support the US, Canada, UK, EU, Australia, and select other markets. ' +
    'Email us at hello@noshowly.com to be notified when we expand.'
  );
}
