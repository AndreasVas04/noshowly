/**
 * lib/plans.ts
 *
 * Single source of truth for Noshowly's subscription plan configuration.
 *
 * Free trial:
 *  - trial — every new account, for TRIAL_LENGTH_DAYS (users.trial_ends_at).
 *    Full access with a small monthly email cap (TRIAL_EMAIL_LIMIT). When it
 *    ends the account is read-only until it subscribes (lib/entitlements.ts).
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
 *  - What an account may do (write, send email, take bookings) is decided by
 *    getEntitlements() in lib/entitlements.ts, which also honours the trial
 *    end date. Never decide access from the plan name alone.
 *
 * Every part of the codebase that touches plan limits or reminder caps MUST
 * import from this file — never hardcode these values.
 */

// ---------------------------------------------------------------------------
// Free trial
// ---------------------------------------------------------------------------

/**
 * Length of the free trial in days. Matches the users.trial_ends_at default
 * (sign-up + 14 days) and the public copy ("14-day free trial").
 */
export const TRIAL_LENGTH_DAYS = 14 as const;

/**
 * Emails (reminders, booking confirmations and test sends together) an
 * account on an active trial may send per month. Internal limit — never shown
 * publicly. Enforced by lib/reminders/gateway.ts through lib/entitlements.ts.
 */
export const TRIAL_EMAIL_LIMIT = 25 as const;

// ---------------------------------------------------------------------------
// Plan limits — { email } caps per month
// ---------------------------------------------------------------------------

/**
 * Monthly reminder caps per subscription plan.
 *
 * Email caps:
 *  - Internal fair-use caps. Public-facing copy always says "Unlimited email reminders".
 *  - The trial cap only applies while the trial is running; an ended trial
 *    and 'cancelled' send nothing (lib/entitlements.ts).
 *  - Never expose these values in any public-facing UI or API response.
 *
 * Legacy plan names (starter, professional) are kept as backward-compatible
 * aliases for existing database values. New accounts start on the trial, and
 * checkout sells basic only.
 */
export const PLAN_LIMITS = {
  // Trial — full access with a small email cap until users.trial_ends_at.
  trial:        { email: TRIAL_EMAIL_LIMIT },

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
 */
export type PaidPlan = 'basic';

/**
 * Full set of values the `users.plan` database column can hold.
 * Extends PlanType with 'cancelled' for accounts whose subscription has lapsed.
 *
 * Use this type in DB row shapes and anywhere the value comes from Supabase.
 */
export type UserPlan = PlanType | 'cancelled';

/**
 * The plan names the database accepts after the data_integrity migration
 * (users_plan_check). parsePlan() in lib/entitlements.ts maps legacy names
 * to these, so access decisions only ever see these five values.
 */
export type CanonicalPlan = 'trial' | 'basic' | 'pro' | 'business' | 'cancelled';

/**
 * Plans that come from a Stripe subscription and give full access. The
 * Stripe webhook maps subscription prices to these (lib/billing/subscriptions.ts).
 */
export type SubscriptionPlan = Extract<CanonicalPlan, 'basic' | 'pro' | 'business'>;

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
 * Burst guard: the most emails (reminders, booking confirmations and test
 * sends together) a single salon may send in any 60-minute window. Not a
 * normal limit — reaching it means something is looping, so further emails
 * are refused and an error is logged. Enforced by lib/reminders/gateway.ts.
 */
export const HOURLY_REMINDER_RATE_LIMIT = 200 as const;

/**
 * The most emails one recipient address may receive from a salon in any
 * 24 hours, across all appointments of that salon. Protects clients from
 * repeated bookings, edits and test sends. Enforced by lib/reminders/gateway.ts.
 */
export const MAX_EMAILS_PER_RECIPIENT_PER_DAY = 5 as const;

/** The most test emails a salon may send in any 24 hours (dashboard "Send reminder"). */
export const MAX_TEST_EMAILS_PER_DAY = 5 as const;

// ---------------------------------------------------------------------------
// Plan utility functions
// ---------------------------------------------------------------------------

/**
 * Returns the monthly email cap of a plan while that plan is in force.
 *
 * Returns 0 for 'cancelled', TRIAL_EMAIL_LIMIT for 'trial' and a finite
 * fair-use cap for all paid plans (2000 for basic, 5000 for pro).
 *
 * It does not know whether a trial has ended: use getEntitlements() from
 * lib/entitlements.ts (emailMonthlyLimit, canSendEmail) for any decision.
 *
 * NOTE: This value must never be displayed publicly. Public copy says "Unlimited email reminders".
 *
 * @param plan - The user's current subscription plan.
 * @returns The internal cap for emails per month.
 *
 * @example
 * getPlanEmailLimit('basic')        // → 2000 (internal fair-use cap)
 * getPlanEmailLimit('pro')          // → 5000 (internal fair-use cap)
 * getPlanEmailLimit('starter')      // → 2000 (legacy alias for basic)
 * getPlanEmailLimit('professional') // → 5000 (legacy alias for pro)
 * getPlanEmailLimit('trial')        // → TRIAL_EMAIL_LIMIT (while the trial runs)
 * getPlanEmailLimit('cancelled')    // → 0
 */
export function getPlanEmailLimit(plan: UserPlan): number {
  if (plan === 'cancelled') return 0;
  return PLAN_LIMITS[plan].email;
}

