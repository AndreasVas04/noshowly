/**
 * lib/reminders/quota.ts
 *
 * The salon owner's monthly email counter (users.email_reminders_used_this_month)
 * and plan checks, for the send gateway (lib/reminders/gateway.ts).
 *
 *  - Plan rules come from lib/entitlements.ts (canSendEmail and
 *    emailMonthlyLimit, which honour the trial end date); no plan is named
 *    here.
 *  - Monthly reset: when users.reminders_reset_at has passed, both counters
 *    (email_reminders_used_this_month and the legacy reminders_used_this_month)
 *    go back to 0 and the reset moves to the first day of the next month, UTC.
 *    The reset only applies while the reset date is still in the past, so two
 *    requests resetting at once cannot wipe each other's increments.
 *  - Counting without a database function: an optimistic update
 *    (set used = n + 1 where used = n). When another send changed the counter
 *    since it was read, the update waits a short random time, reads the counter
 *    again and retries, up to COUNTER_UPDATE_ATTEMPTS times. Each failed
 *    attempt means another send's increment landed, so an increment is only
 *    lost when more sends than that finish for the same owner at the same
 *    moment; it is then logged by the gateway. The counter is an internal
 *    fair-use cap, so such a rare undercount is acceptable.
 *  - The cap is checked before an email is recorded and sent, and the counter
 *    goes up after the send, so sends that run at the same moment can all pass
 *    the check and end slightly over the cap. Acceptable for a fair-use cap;
 *    the sending limits in lib/reminders/rules.ts work the same way.
 *
 * The database is reached through the CounterStore interface
 * (lib/reminders/store.ts implements it with Supabase), so the logic can be
 * tested without a database.
 */

import type { Entitlements } from '@/lib/entitlements';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** How many times an increment is tried before giving up. */
export const COUNTER_UPDATE_ATTEMPTS = 12;

/** Backoff ceiling after the first failed attempt; it doubles with every attempt. */
const COUNTER_RETRY_BASE_DELAY_MS = 20;

/** Largest backoff ceiling between two attempts. */
const COUNTER_RETRY_MAX_DELAY_MS = 200;

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

/**
 * Result of checkEmailQuota(): 'plan' when the account cannot send email
 * (ended trial or inactive subscription), 'trial_cap' / 'monthly_cap' when
 * the trial's or the paid plan's monthly cap is reached.
 */
export type QuotaCheck = 'ok' | 'plan' | 'trial_cap' | 'monthly_cap';

/** Result of incrementEmailCounter(). */
export type IncrementResult =
  | { ok: true; counter: CounterSnapshot }
  | { ok: false; counter: CounterSnapshot };

/** Options of incrementEmailCounter() (injectable for tests). */
export type IncrementOptions = {
  /** Maximum update attempts (default COUNTER_UPDATE_ATTEMPTS). */
  attempts?: number;
  /** Waits between attempts (default: a timer). */
  sleep?: (ms: number) => Promise<void>;
  /** Random number in [0, 1) for the backoff (default Math.random). */
  random?: () => number;
};

// ---------------------------------------------------------------------------
// Plan and cap
// ---------------------------------------------------------------------------

/**
 * Checks whether the owner may send another email this month.
 *
 * An ended trial, an inactive subscription and a plan name that is not
 * known (read as 'cancelled' by parsePlan()) cannot send email. The caps are
 * internal limits and must never be shown publicly.
 *
 * @param entitlements - The owner's entitlements (getEntitlements()).
 * @param used         - Emails sent this month.
 */
export function checkEmailQuota(
  entitlements: Pick<Entitlements, 'canSendEmail' | 'emailMonthlyLimit' | 'isTrial'>,
  used: number,
): QuotaCheck {
  const limit = entitlements.emailMonthlyLimit;
  if (!entitlements.canSendEmail || !Number.isFinite(limit) || limit <= 0) return 'plan';
  if (used < limit) return 'ok';
  return entitlements.isTrial ? 'trial_cap' : 'monthly_cap';
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
 * Backoff before an increment is tried again: a random delay between 0 and
 * min(COUNTER_RETRY_MAX_DELAY_MS, COUNTER_RETRY_BASE_DELAY_MS × 2^(attempt − 1)),
 * so sends that collided spread out instead of colliding again in lockstep.
 *
 * @param attempt - Attempts made so far (1 after the first failed attempt).
 * @param random  - Random number in [0, 1).
 * @returns       Delay in milliseconds.
 */
export function counterRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(
    COUNTER_RETRY_MAX_DELAY_MS,
    COUNTER_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
  return Math.floor(random() * ceiling);
}

/** Resolves after `ms` milliseconds. */
function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds one to the owner's monthly counter. The update only applies while the
 * counter still holds the value it was read with; otherwise another send's
 * increment landed in between, so the counter is read again after a short
 * random backoff and the update retried. With N sends finishing for the same
 * owner at the same moment, each needs at most N attempts (one failure per
 * other send's increment, plus one when the snapshot was already stale), so
 * nothing is lost below COUNTER_UPDATE_ATTEMPTS concurrent sends.
 *
 * @param store    - Counter storage.
 * @param userId   - Salon owner.
 * @param snapshot - Counter as last read.
 * @param options  - Attempts, sleep and random (for tests).
 * @returns        The counter after the increment, or ok: false (with the
 *                 last value read) when every attempt lost a race.
 */
export async function incrementEmailCounter(
  store: CounterStore,
  userId: string,
  snapshot: CounterSnapshot,
  options: IncrementOptions = {},
): Promise<IncrementResult> {
  const attempts = options.attempts ?? COUNTER_UPDATE_ATTEMPTS;
  const sleep    = options.sleep ?? sleepFor;
  let current = snapshot;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const next = current.used + 1;
    if (await store.compareAndSet(userId, current.used, next)) {
      return { ok: true, counter: { ...current, used: next } };
    }
    if (attempt === attempts) break;

    // Another send changed the counter since it was read: back off, read it again.
    await sleep(counterRetryDelayMs(attempt, options.random));
    const fresh = await store.read(userId);
    if (!fresh) break;
    current = fresh;
  }
  return { ok: false, counter: current };
}
