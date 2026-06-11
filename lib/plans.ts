/**
 * lib/plans.ts
 *
 * Single source of truth for Noshowly's subscription plan configuration.
 *
 * Public plan (the ONLY plan available via checkout and pricing UI for MVP):
 *  - Basic — Unlimited email reminders (2,000/month internal fair-use cap), no SMS. $19/month.
 *
 * Internal/legacy plans (kept for DB compatibility — NOT available via public checkout or pricing UI):
 *  - pro          — Internal/future plan. Hidden from public UI and checkout.
 *  - business     — Internal/future plan. Hidden from public UI and checkout.
 *  - starter      — Legacy alias for Basic. Backward-compatible with existing DB values.
 *  - professional — Legacy alias for Pro. Backward-compatible with existing DB values.
 *
 * SMS policy for MVP:
 *  - SMS is not offered publicly. Basic has sms: 0.
 *  - Do not mention SMS in any public UI, pricing page, or landing page.
 *  - SMS infrastructure remains in the codebase for future plans but is disabled for all public plans.
 *
 * RULES (never violate):
 *  - Email limits are internal fair-use caps — never shown publicly. Public copy says "Unlimited email reminders".
 *  - Never increase SMS limits without checking real SMS provider costs per country first.
 *  - Never price SMS add-ons at break-even or below cost.
 *
 * Every part of the codebase that touches plan limits, reminder caps, or
 * geo-blocking MUST import from this file — never hardcode these values.
 */

// ---------------------------------------------------------------------------
// Plan limits — { sms, email } caps per month
// ---------------------------------------------------------------------------

/**
 * Monthly reminder caps per subscription plan.
 *
 * SMS caps:
 *  - 0 means SMS is not available on this plan. Never offer unlimited SMS.
 *
 * Email caps:
 *  - Internal fair-use caps. Public-facing copy always says "Unlimited email reminders".
 *  - 0 means email reminders are disabled (trial).
 *  - Never expose these values in any public-facing UI or API response.
 *
 * Legacy plan names (starter, professional) are kept as backward-compatible
 * aliases for existing database values. All new users get basic or pro only.
 */
export const PLAN_LIMITS = {
  // Trial — no reminders; user must upgrade to activate messaging.
  trial:        { sms: 0,   email: 0 },

  // Basic ($19/month) — unlimited email (internal fair-use cap: 2,000/month), no SMS.
  basic:        { sms: 0,   email: 2000 },

  // Pro ($39/month) — 100 SMS/month + unlimited email (internal fair-use cap: 5,000/month).
  pro:          { sms: 100, email: 5000 },

  // Business — internal/future use only. NOT available via public checkout or pricing UI.
  business:     { sms: 1000, email: 10000 },

  // ---- Legacy aliases — backward-compatible with existing database values ----
  // Do not use these for new code; use basic/pro instead.
  starter:      { sms: 0,   email: 2000 },   // same as basic
  professional: { sms: 100, email: 5000 },   // same as pro
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
 * The only publicly available paid plan key for MVP.
 * Used for Stripe checkout and pricing page CTA buttons.
 *
 * Pro and Business are intentionally excluded — internal/future only.
 * starter/professional are excluded — they are legacy DB aliases only.
 * SMS is not offered publicly — Basic has sms: 0.
 */
export type PaidPlan = 'basic';

/**
 * Full set of values the `users.plan` database column can hold.
 * Extends PlanType with 'cancelled' for accounts whose subscription has lapsed.
 *
 * Use this type in DB row shapes and anywhere the value comes from Supabase.
 */
export type UserPlan = PlanType | 'cancelled';

// ---------------------------------------------------------------------------
// Plan prices (USD per month) — public paid plans only
// ---------------------------------------------------------------------------

/**
 * Monthly subscription price for each public paid plan, in USD.
 * These are display-only — actual billing is managed by Stripe price IDs.
 *
 * Never hardcode these values outside of this file.
 */
export const PLAN_PRICES: Record<PaidPlan, number> = {
  basic: 19,
};

// ---------------------------------------------------------------------------
// Email fair-use caps (INTERNAL ONLY — never shown publicly)
// ---------------------------------------------------------------------------

/**
 * Internal monthly email reminder fair-use caps per plan.
 *
 * IMPORTANT: These values must NEVER be shown in any public-facing UI, API
 * response, or marketing copy. Public copy always says "Unlimited email reminders".
 *
 * These caps exist to protect system resources and ensure fair use across all salons.
 *
 * TODO: Add admin notification when a salon exceeds 80% of their email fair-use cap.
 *       Implement via a separate monitoring job that queries email_reminders_used_this_month.
 */
export const EMAIL_FAIR_USE_CAPS: Record<PlanType, number> = {
  trial:        0,
  basic:        2000,
  pro:          5000,
  business:     10000,
  starter:      2000,
  professional: 5000,
};

// ---------------------------------------------------------------------------
// SMS add-on
// ---------------------------------------------------------------------------

/**
 * Price (USD/month) for the SMS add-on: adds SMS_ADDON_AMOUNT additional reminders.
 *
 * Pricing rule: the add-on price must always be higher than the real SMS provider
 * cost per country. Never price SMS add-ons at break-even or below cost.
 * (Example: 100 SMS in Cyprus via Twilio costs ~$8.64 before Stripe fees and overhead,
 * so $8/month would lose money.)
 *
 * This add-on is NOT automated — users contact support at noshowly@gmail.com.
 * Never offer unlimited SMS.
 */
export const SMS_ADDON_PRICE  = 12 as const;

/**
 * Number of additional SMS reminders per add-on unit purchased.
 */
export const SMS_ADDON_AMOUNT = 100 as const;

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
 * Sent 24 h before (same window as SMS); the 2-hour window absorbs cron jitter.
 */
export const EMAIL_REMINDER_WINDOW = { minHours: 23, maxHours: 25 } as const;

// ---------------------------------------------------------------------------
// Plan utility functions
// ---------------------------------------------------------------------------

/**
 * Returns the monthly SMS reminder limit for a given plan.
 *
 * Returns 0 for 'cancelled' accounts — they cannot send any reminders.
 * Returns 0 for trial, basic, and starter — SMS is not available on those plans.
 *
 * @param plan - The user's current subscription plan.
 * @returns The maximum number of SMS reminders allowed per month.
 *
 * @example
 * getPlanSMSLimit('pro')          // → 100
 * getPlanSMSLimit('professional') // → 100 (legacy alias for pro)
 * getPlanSMSLimit('business')     // → 1000 (internal plan)
 * getPlanSMSLimit('basic')        // → 0  (email-only plan)
 * getPlanSMSLimit('trial')        // → 0
 * getPlanSMSLimit('cancelled')    // → 0
 */
export function getPlanSMSLimit(plan: UserPlan): number {
  if (plan === 'cancelled') return 0;
  return PLAN_LIMITS[plan].sms;
}

/**
 * Returns the monthly email reminder fair-use cap for a given plan.
 *
 * Returns 0 for 'cancelled' and 'trial' accounts.
 * Returns a finite fair-use cap for all paid plans (2000 for basic, 5000 for pro).
 *
 * NOTE: This value must never be displayed publicly. Public copy says "Unlimited email reminders".
 *
 * @param plan - The user's current subscription plan.
 * @returns The internal fair-use cap for email reminders per month.
 *
 * @example
 * getPlanEmailLimit('basic')        // → 2000 (internal fair-use cap)
 * getPlanEmailLimit('pro')          // → 5000 (internal fair-use cap)
 * getPlanEmailLimit('starter')      // → 2000 (legacy alias for basic)
 * getPlanEmailLimit('professional') // → 5000 (legacy alias for pro)
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
 * Only 'pro', 'professional' (legacy), and 'business' (internal) plans include SMS.
 * Trial, basic, starter, and cancelled plans return false.
 *
 * @param plan - The user's current subscription plan.
 * @returns true if SMS reminders are permitted on this plan.
 *
 * @example
 * planAllowsSMS('pro')          // → true
 * planAllowsSMS('professional') // → true (legacy alias for pro)
 * planAllowsSMS('business')     // → true (internal plan)
 * planAllowsSMS('basic')        // → false (email-only plan)
 * planAllowsSMS('starter')      // → false (legacy alias for basic)
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
 * All paid plans (basic, pro, and legacy aliases) include email reminders.
 * Trial and cancelled plans return false.
 *
 * @param plan - The user's current subscription plan.
 * @returns true if email reminders are permitted on this plan.
 *
 * @example
 * planAllowsEmail('basic')        // → true
 * planAllowsEmail('pro')          // → true
 * planAllowsEmail('starter')      // → true (legacy alias for basic)
 * planAllowsEmail('professional') // → true (legacy alias for pro)
 * planAllowsEmail('business')     // → true (internal plan)
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
    'Email us at noshowly@gmail.com to be notified when we expand.'
  );
}
