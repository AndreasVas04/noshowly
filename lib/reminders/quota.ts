/**
 * lib/reminders/quota.ts
 *
 * The salon owner's monthly email counter (users.email_reminders_used_this_month)
 * and plan checks, for the send gateway (lib/reminders/gateway.ts).
 *
 *  - Plan rules come from lib/plans.ts (planAllowsEmail, getPlanEmailLimit);
 *    no plan is named here.
 *  - Monthly reset: when users.reminders_reset_at has passed, both counters
 *    (email_reminders_used_this_month and the legacy reminders_used_this_month)
 *    go back to 0 and the reset moves to the first day of the next month, UTC.
 *    The reset only applies while the reset date is still in the past, so two
 *    requests resetting at once cannot wipe each other's increments.
 *  - Counting without a database function: an optimistic update
 *    (set used = n + 1 where used = n) that re-reads and retries when another
 *    send changed the counter in between, so no increment is lost.
 *
 * The database is reached through the CounterStore interface
 * (lib/reminders/store.ts implements it with Supabase), so the logic can be
 * tested without a database.
 */

import { getPlanEmailLimit, planAllowsEmail, type UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** How many times an increment is tried before giving up. */
export const COUNTER_UPDATE_ATTEMPTS = 5;

/** The owner's email counter as read from the users row. */
export type CounterSnapshot = {
  /** users.email_reminders_used_this_month */
  used: number;
  /** users.reminders_reset_at (ISO timestamp) */
  resetAt: string;
};

/** Database operations on the counter. Methods throw on database errors. */
export interface CounterStore {
  /** Reads the counter; null when the user does not exist. */
  read(userId: string): Promise<CounterSnapshot | null>;
  /**
   * Resets both counters to 0 and sets reminders_reset_at to `nextResetAt`,
   * only while reminders_reset_at <= now. Returns the counter after the reset,
   * or null when nothing was reset (another request did it first).
   */
  resetIfDue(userId: string, now: Date, nextResetAt: string): Promise<CounterSnapshot | null>;
  /** Sets the counter to `next` only while it equals `expected`; true when updated. */
  compareAndSet(userId: string, expected: number, next: number): Promise<boolean>;
}

/** Result of checkEmailQuota(). */
export type QuotaCheck = 'ok' | 'plan' | 'monthly_cap';

/** Result of incrementEmailCounter(). */
export type IncrementResult =
  | { ok: true; counter: CounterSnapshot }
  | { ok: false; counter: CounterSnapshot };

// ---------------------------------------------------------------------------
// Plan and cap
// ---------------------------------------------------------------------------

/**
 * Checks whether the owner may send another email this month.
 *
 * A plan name lib/plans.ts does not know is treated as a plan without email.
 * The cap is an internal fair-use limit and must never be shown publicly.
 *
 * @param plan - users.plan
 * @param used - Emails sent this month.
 */
export function checkEmailQuota(plan: string, used: number): QuotaCheck {
  let allowed: boolean;
  let limit: number;
  try {
    allowed = planAllowsEmail(plan as UserPlan);
    limit   = getPlanEmailLimit(plan as UserPlan);
  } catch {
    return 'plan';
  }
  if (!allowed || typeof limit !== 'number' || Number.isNaN(limit)) return 'plan';
  return used >= limit ? 'monthly_cap' : 'ok';
}

// ---------------------------------------------------------------------------
// Monthly reset
// ---------------------------------------------------------------------------

/**
 * Returns the next monthly reset: the first day of the next month, 00:00 UTC.
 *
 * @param now - Current instant.
 */
export function nextMonthlyResetAt(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Returns true when the counter's reset date has passed (or is unreadable). */
export function isResetDue(resetAt: string, now: Date): boolean {
  const ms = Date.parse(resetAt);
  return !Number.isFinite(ms) || now.getTime() >= ms;
}

/**
 * Resets the counter when a new month has started (lazily, on the first send
 * of the month).
 *
 * @param store    - Counter storage.
 * @param userId   - Salon owner.
 * @param snapshot - Counter as last read.
 * @param now      - Current instant.
 * @returns        The counter for the current month.
 */
export async function refreshMonthlyPeriod(
  store: CounterStore,
  userId: string,
  snapshot: CounterSnapshot,
  now: Date,
): Promise<CounterSnapshot> {
  if (!isResetDue(snapshot.resetAt, now)) return snapshot;

  const reset = await store.resetIfDue(userId, now, nextMonthlyResetAt(now));
  if (reset) return reset;

  // Another request reset the counter first: use its current values.
  return (await store.read(userId)) ?? snapshot;
}

// ---------------------------------------------------------------------------
// Optimistic increment
// ---------------------------------------------------------------------------

/**
 * Adds one to the owner's monthly counter without losing concurrent
 * increments: the update only applies while the counter still holds the value
 * it was read with; otherwise the counter is read again and the update retried.
 *
 * @param store    - Counter storage.
 * @param userId   - Salon owner.
 * @param snapshot - Counter as last read.
 * @param attempts - Maximum update attempts.
 * @returns        The counter after the increment, or ok: false (with the
 *                 last value read) when every attempt lost a race.
 */
export async function incrementEmailCounter(
  store: CounterStore,
  userId: string,
  snapshot: CounterSnapshot,
  attempts = COUNTER_UPDATE_ATTEMPTS,
): Promise<IncrementResult> {
  let current = snapshot;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const next = current.used + 1;
    if (await store.compareAndSet(userId, current.used, next)) {
      return { ok: true, counter: { ...current, used: next } };
    }
    // Another send changed the counter since it was read: read it again.
    const fresh = await store.read(userId);
    if (!fresh) break;
    current = fresh;
  }
  return { ok: false, counter: current };
}
