/**
 * lib/plans.ts
 *
 * Single source of truth for Noshowly's subscription plan configuration.
 *
 * Plans are organised into three tiers:
 *  - Starter      — Unlimited email reminders, no SMS. $19/month.
 *  - Professional — 300 SMS/month + unlimited email reminders. $39/month.
 *  - Business     — 1,000 SMS/month + unlimited email reminders. $79/month.
 *
 * Every part of the codebase that touches plan limits, reminder caps, or
 * geo-blocking MUST import from this file — never hardcode these values.
 *
 * Key decisions baked in here (see CLAUDE.md §5 for rationale):
 *  - Trial accounts send no reminders (sms=0, email=0).
 *  - A plan with sms=0 must never send SMS.
 *  - All paid plans include unlimited email reminders (represented as 999999).
 *  - SMS add-on: +100 SMS for $4/month — handled outside this file.
 *  - Accounts from countries where SMS costs > $0.08/msg are blocked on signup.
 */

// ---------------------------------------------------------------------------
// Plan limits — { sms, email } caps per month
// ---------------------------------------------------------------------------

/**
 * Monthly reminder caps per subscription plan.
 *
 * Each entry is { sms: number, email: number }.
 *  - 0 in a channel means that channel is not available on this plan.
 *  - 999999 represents effectively unlimited (no practical cap).
 *  - trial.sms = 0 and trial.email = 0 → no reminders sent during trial.
 */
export const PLAN_LIMITS = {
  // Trial — no reminders; user must upgrade to activate messaging.
  trial: { sms: 0, email: 0 },

  // Starter — unlimited email, no SMS.
  starter: { sms: 0, email: 999999 },

  // Professional — 300 SMS/month + unlimited email.
  professional: { sms: 300, email: 999999 },

  // Business — 1,000 SMS/month + unlimited email.
  business: { sms: 1000, email: 999999 },
} as const;

/**
 * Active subscription plan keys — derived from PLAN_LIMITS so the two stay
 * in sync automatically. Does NOT include 'cancelled'.
 *
 * Use this type when enforcing limits or checking plan features.
 * Use UserPlan (below) when reading the `plan` column from the database.
 */
export type PlanType = keyof typeof PLAN_LIMITS;

/**
 * All paid (non-trial) plan keys — the 3 plans a business owner can subscribe to.
 * Used for Stripe checkout and pricing page CTA buttons.
 */
export type PaidPlan = 'starter' | 'professional' | 'business';

/**
 * Full set of values the `users.plan` database column can hold.
 * Extends PlanType with 'cancelled' for accounts whose subscription has lapsed.
 *
 * Use this type in DB row shapes and anywhere the value comes from Supabase.
 */
export type UserPlan = PlanType | 'cancelled';

// ---------------------------------------------------------------------------
// Plan prices (USD per month)
// ---------------------------------------------------------------------------

/**
 * Monthly subscription price for each paid plan, in USD.
 * These are display-only — actual billing is managed by Stripe price IDs.
 *
 * Never hardcode these values outside of this file.
 */
export const PLAN_PRICES: Record<PaidPlan, number> = {
  starter:      19,
  professional: 39,
  business:     79,
};

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
 * Email is sent 24 h before (same window as SMS); the 2-hour window absorbs cron jitter.
 */
export const EMAIL_REMINDER_WINDOW = { minHours: 23, maxHours: 25 } as const;

// ---------------------------------------------------------------------------
// Plan utility functions
// ---------------------------------------------------------------------------

/**
 * Returns the monthly SMS reminder limit for a given plan.
 *
 * Returns 0 for 'cancelled' accounts — they cannot send any reminders.
 * Returns 0 for 'trial' and 'starter' — SMS is not available on those plans.
 *
 * @param plan - The user's current subscription plan.
 * @returns The maximum number of SMS reminders allowed per month.
 *
 * @example
 * getPlanSMSLimit('professional') // → 300
 * getPlanSMSLimit('business')     // → 1000
 * getPlanSMSLimit('starter')      // → 0  (email-only plan)
 * getPlanSMSLimit('trial')        // → 0
 * getPlanSMSLimit('cancelled')    // → 0
 */
export function getPlanSMSLimit(plan: UserPlan): number {
  if (plan === 'cancelled') return 0;
  return PLAN_LIMITS[plan].sms;
}

/**
 * Returns the monthly email reminder limit for a given plan.
 *
 * Returns 0 for 'cancelled' and 'trial' accounts.
 * Returns 999999 (effectively unlimited) for all paid plans.
 *
 * @param plan - The user's current subscription plan.
 * @returns The maximum number of email reminders allowed per month.
 *
 * @example
 * getPlanEmailLimit('starter')      // → 999999 (unlimited)
 * getPlanEmailLimit('professional') // → 999999 (unlimited)
 * getPlanEmailLimit('business')     // → 999999 (unlimited)
 * getPlanEmailLimit('trial')        // → 0
 * getPlanEmailLimit('cancelled')    // → 0
 */
export function getPlanEmailLimit(plan: UserPlan): number {
  if (plan === 'cancelled') return 0;
  return PLAN_LIMITS[plan].email;
}

/**
 * Returns true if the given plan allows SMS reminders to be sent.
 *
 * Only 'professional' and 'business' plans include SMS.
 * Trial, starter, and cancelled plans return false.
 *
 * @param plan - The user's current subscription plan.
 * @returns true if SMS reminders are permitted on this plan.
 *
 * @example
 * planAllowsSMS('professional') // → true
 * planAllowsSMS('business')     // → true
 * planAllowsSMS('starter')      // → false (email-only plan)
 * planAllowsSMS('trial')        // → false
 * planAllowsSMS('cancelled')    // → false
 */
export function planAllowsSMS(plan: UserPlan): boolean {
  if (plan === 'cancelled') return false;
  return PLAN_LIMITS[plan].sms > 0;
}

/**
 * Returns true if the given plan allows email reminders to be sent.
 *
 * All paid plans (starter, professional, business) include unlimited email.
 * Trial and cancelled plans return false.
 *
 * @param plan - The user's current subscription plan.
 * @returns true if email reminders are permitted on this plan.
 *
 * @example
 * planAllowsEmail('starter')      // → true
 * planAllowsEmail('professional') // → true
 * planAllowsEmail('business')     // → true
 * planAllowsEmail('trial')        // → false (no reminders during trial)
 * planAllowsEmail('cancelled')    // → false
 */
export function planAllowsEmail(plan: UserPlan): boolean {
  if (plan === 'cancelled') return false;
  return PLAN_LIMITS[plan].email > 0;
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
 * regions where Noshowly is available.
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
    "Noshowly isn't available in your region yet. " +
    'We currently support the US, Canada, UK, EU, Australia, and select other markets. ' +
    'Email us at hello@noshowly.com to be notified when we expand.'
  );
}
