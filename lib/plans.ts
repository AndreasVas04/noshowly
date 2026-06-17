/**
 * lib/plans.ts
 *
 * Single source of truth for Noshowly's subscription plan configuration.
 *
 * Public plan (the ONLY plan available via checkout and pricing UI for MVP):
 *  - Basic — Unlimited email reminders (2,000/month internal fair-use cap). $19/month.
 *
 * Internal/legacy plans (kept for DB compatibility — NOT available via public checkout or pricing UI):
 *  - pro          — Internal/future plan. Hidden from public UI and checkout.
 *  - business     — Internal/future plan. Hidden from public UI and checkout.
 *  - starter      — Legacy alias for Basic. Backward-compatible with existing DB values.
 *  - professional — Legacy alias for Pro. Backward-compatible with existing DB values.
 *
 * RULES (never violate):
 *  - Email limits are internal fair-use caps — never shown publicly. Public copy says "Unlimited email reminders".
 *
 * Every part of the codebase that touches plan limits, reminder caps, or
 * geo-blocking MUST import from this file — never hardcode these values.
 */

// ---------------------------------------------------------------------------
// Plan limits — { email } caps per month
// ---------------------------------------------------------------------------

/**
 * Monthly reminder caps per subscription plan.
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
  trial:        { email: 0 },

  // Basic ($19/month) — unlimited email (internal fair-use cap: 2,000/month).
  basic:        { email: 2000 },

  // Pro — internal/future use only. NOT available via public checkout or pricing UI.
  pro:          { email: 5000 },

  // Business — internal/future use only. NOT available via public checkout or pricing UI.
  business:     { email: 10000 },

  // ---- Legacy aliases — backward-compatible with existing database values ----
  // Do not use these for new code; use basic/pro instead.
  starter:      { email: 2000 },   // same as basic
  professional: { email: 5000 },   // same as pro
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
// Reminder dispatch constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of reminders a single salon may send in any 60-minute window.
 * Exceeding this triggers an alert and blocks further sending for that window.
 * Protects against runaway cron jobs and misconfigured pg_cron schedules.
 */
export const HOURLY_REMINDER_RATE_LIMIT = 20 as const;

/**
 * Appointment time window (hours from now) that triggers an email reminder.
 * pg_cron runs every hour; any appointment falling in the [minHours, maxHours]
 * window gets a reminder. The 2-hour window absorbs cron jitter.
 */
export const EMAIL_REMINDER_WINDOW = { minHours: 23, maxHours: 25 } as const;

// ---------------------------------------------------------------------------
// Plan utility functions
// ---------------------------------------------------------------------------

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

