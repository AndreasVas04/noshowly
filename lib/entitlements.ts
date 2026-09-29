/**
 * lib/entitlements.ts
 *
 * What an account may do, decided from its users row (plan and
 * trial_ends_at). Every access decision goes through getEntitlements():
 *  - the dashboard API write routes (requireWriteAccess in lib/access.ts);
 *  - the public booking page and its API (salonAcceptsBookings in
 *    lib/booking-data.ts);
 *  - the email gateway (lib/reminders/gateway.ts);
 *  - the dashboard banner, the Billing section in Settings (GET /api/billing),
 *    the pricing page and checkout.
 *
 * Rules:
 *  - basic, pro, business: full access; email up to the plan's monthly
 *    fair-use cap (PLAN_LIMITS in lib/plans.ts).
 *  - trial, before trial_ends_at: full access; email up to TRIAL_EMAIL_LIMIT
 *    a month.
 *  - trial from trial_ends_at on, and cancelled: read-only. Data and settings
 *    can be viewed, and PUT /api/salon still works so the owner can fix their
 *    account, but staff, services, availability, appointments, clients and
 *    the booking page cannot be created or changed, no email is sent, and the
 *    public booking page does not take bookings.
 *
 * The plan column is read with parsePlan(): legacy names from before the
 * data_integrity migration map to their current plan, and an unknown value
 * counts as 'cancelled' (fail closed) and is logged.
 *
 * The database enforces canWrite for writes made with an owner's own session
 * through public.owner_has_write_access()
 * (supabase/migrations/20260929120000_read_only_accounts.sql). Changing these
 * rules needs a migration that changes that function too.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere,
 * including Client Components.
 */

import { PLAN_LIMITS, type CanonicalPlan, type SubscriptionPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** One day in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The users row fields entitlements are derived from. */
export type EntitlementSource = {
  /** users.plan, any value (read with parsePlan()). */
  plan: string | null | undefined;
  /** users.trial_ends_at (ISO timestamp). */
  trial_ends_at: string | null | undefined;
};

/** What an account may do right now. */
export type Entitlements = {
  /** The plan, with legacy names mapped (parsePlan()). */
  plan: CanonicalPlan;
  /** basic, pro or business. */
  isPaid: boolean;
  /** On the free trial, running or ended. */
  isTrial: boolean;
  /** When the free trial ends or ended (ISO timestamp), null when unknown. */
  trialEndsAt: string | null;
  /**
   * Whole days left in a running trial (at least 1), 0 once it has ended,
   * null when the account is not on the trial.
   */
  trialDaysLeft: number | null;
  /** On the trial, and its end date has passed (or is unknown). */
  trialExpired: boolean;
  /** May create, change and delete data, and take public bookings. */
  canWrite: boolean;
  /** May send emails, up to emailMonthlyLimit a month. */
  canSendEmail: boolean;
  /** Emails allowed per month; 0 when canSendEmail is false. Internal: never shown publicly. */
  emailMonthlyLimit: number;
};

/** Why an account is read-only, as shown to the owner. */
export type AccessDenial = {
  code: 'trial_ended' | 'subscription_inactive';
  message: string;
};

/** Shown when an action is refused because the free trial has ended. */
export const TRIAL_ENDED_MESSAGE = 'Your trial has ended. Upgrade to keep using Noshowly.';

/** Shown when an action is refused because the subscription is not active. */
export const SUBSCRIPTION_INACTIVE_MESSAGE =
  'Your subscription is inactive. Upgrade to keep using Noshowly.';

/** Plan names the database accepts (users_plan_check). */
const CANONICAL_PLANS: ReadonlySet<string> = new Set<CanonicalPlan>([
  'trial', 'basic', 'pro', 'business', 'cancelled',
]);

/** Plans that come with a subscription. */
const SUBSCRIPTION_PLANS: ReadonlySet<string> = new Set<SubscriptionPlan>(['basic', 'pro', 'business']);

/**
 * Plan names from before the data_integrity migration, mapped the way that
 * migration renames them (supabase/migrations/20260928130000_data_integrity.sql):
 * professional to pro, starter and the SMS-era names to basic.
 */
const LEGACY_PLAN_ALIASES: ReadonlyMap<string, CanonicalPlan> = new Map<string, CanonicalPlan>([
  ['starter', 'basic'],
  ['professional', 'pro'],
  ['solo-sms', 'basic'], ['team-sms', 'basic'], ['studio-sms', 'basic'],
  ['solo-email', 'basic'], ['team-email', 'basic'], ['studio-email', 'basic'],
  ['solo-both', 'basic'], ['team-both', 'basic'], ['studio-both', 'basic'],
]);

/** Values parsePlan() has already logged, so an old database does not log on every request. */
const loggedPlanValues = new Set<string>();

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * Reads a users.plan value.
 *
 *  - Current names are returned as they are.
 *  - Legacy names (databases that have not run the data_integrity migration)
 *    map to their current plan, with a warning.
 *  - Anything else, including a missing value, is 'cancelled' (no access),
 *    with an error. Each value is logged once per server instance.
 *
 * @param value - users.plan as read from the database.
 *
 * @example
 * parsePlan('basic')    // → 'basic'
 * parsePlan('starter')  // → 'basic' (legacy)
 * parsePlan('gold')     // → 'cancelled' (unknown, logged)
 */
export function parsePlan(value: unknown): CanonicalPlan {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (CANONICAL_PLANS.has(name)) return name as CanonicalPlan;

  const alias = LEGACY_PLAN_ALIASES.get(name);
  if (alias) {
    logOnce(`legacy:${name}`, () =>
      console.warn(
        `[entitlements] Legacy plan "${name}" read as "${alias}". ` +
        'Run the data_integrity migration to rename it in the database.',
      ),
    );
    return alias;
  }

  logOnce(`unknown:${String(value)}`, () =>
    console.error(`[entitlements] Unknown plan ${JSON.stringify(value) ?? 'undefined'}, treated as 'cancelled'`),
  );
  return 'cancelled';
}

/** Returns true for basic, pro and business. */
export function isSubscriptionPlan(plan: CanonicalPlan): plan is SubscriptionPlan {
  return SUBSCRIPTION_PLANS.has(plan);
}

/**
 * Name of a plan as shown to the owner.
 *
 * @param plan - Canonical plan.
 */
export function planLabel(plan: CanonicalPlan): string {
  switch (plan) {
    case 'trial':    return 'Free trial';
    case 'basic':    return 'Basic';
    case 'pro':      return 'Pro';
    case 'business': return 'Business';
    default:         return 'Inactive';
  }
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/**
 * Decides what an account may do at `now`.
 *
 * A trial is running while now < trial_ends_at; at trial_ends_at it has
 * ended. A trial without a readable end date counts as ended (fail closed;
 * the column is NOT NULL, so this does not happen in practice).
 *
 * @param source - users.plan and users.trial_ends_at.
 * @param now    - Current instant.
 */
export function getEntitlements(source: EntitlementSource, now: Date): Entitlements {
  const plan = parsePlan(source.plan);
  const endsAtMs = parseTimestamp(source.trial_ends_at);

  const isPaid = isSubscriptionPlan(plan);
  const isTrial = plan === 'trial';
  const trialExpired = isTrial && (endsAtMs === null || now.getTime() >= endsAtMs);
  const trialDaysLeft = !isTrial
    ? null
    : trialExpired || endsAtMs === null
      ? 0
      : Math.max(1, Math.ceil((endsAtMs - now.getTime()) / DAY_MS));

  const active = isPaid || (isTrial && !trialExpired);
  const emailMonthlyLimit = active ? PLAN_LIMITS[plan as SubscriptionPlan | 'trial'].email : 0;

  return {
    plan,
    isPaid,
    isTrial,
    trialEndsAt: endsAtMs === null ? null : new Date(endsAtMs).toISOString(),
    trialDaysLeft,
    trialExpired,
    canWrite: active,
    canSendEmail: active && emailMonthlyLimit > 0,
    emailMonthlyLimit,
  };
}

/**
 * Returns why the account cannot make changes, or null when it can.
 *
 * @param entitlements - From getEntitlements().
 */
export function accessDenial(
  entitlements: Pick<Entitlements, 'canWrite' | 'isTrial'>,
): AccessDenial | null {
  if (entitlements.canWrite) return null;
  return entitlements.isTrial
    ? { code: 'trial_ended', message: TRIAL_ENDED_MESSAGE }
    : { code: 'subscription_inactive', message: SUBSCRIPTION_INACTIVE_MESSAGE };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Epoch milliseconds of a timestamp, or null when missing or unreadable. */
function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Runs `log` the first time `key` is seen by this server instance. */
function logOnce(key: string, log: () => void): void {
  if (loggedPlanValues.has(key)) return;
  loggedPlanValues.add(key);
  log();
}
