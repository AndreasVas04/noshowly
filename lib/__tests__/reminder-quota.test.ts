/**
 * lib/__tests__/reminder-quota.test.ts
 *
 * Unit tests for the monthly email counter and plan checks in
 * lib/reminders/quota.ts against an in-memory CounterStore: plan and cap
 * decisions (from lib/entitlements.ts, trial expiry included), the lazy
 * monthly reset and the optimistic increment (with its random backoff) under
 * concurrent updates.
 */

import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, TRIAL_EMAIL_LIMIT, getPlanEmailLimit, type PlanType } from '@/lib/plans';
import { getEntitlements } from '@/lib/entitlements';
import {
  COUNTER_UPDATE_ATTEMPTS,
  checkEmailQuota,
  counterRetryDelayMs,
  incrementEmailCounter,
  isResetDue,
  nextMonthlyResetAt,
  refreshMonthlyPeriod,
  type CounterSnapshot,
  type CounterStore,
} from '@/lib/reminders/quota';

/** Lets other pending async work run, so concurrent increments interleave. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** In-memory users table with the two monthly counters. */
class MemoryCounterStore implements CounterStore {
  users = new Map<string, { used: number; legacy: number; resetAt: string }>();
  reads = 0;
  writes = 0;
  /** Called before every compare-and-set, to simulate another request's write. */
  beforeWrite: (() => void) | null = null;

  constructor(used: number, resetAt: string, legacy = 3) {
    this.users.set('u1', { used, legacy, resetAt });
  }

  get(): { used: number; legacy: number; resetAt: string } {
    return this.users.get('u1')!;
  }

  async read(userId: string): Promise<CounterSnapshot | null> {
    await tick();
    this.reads++;
    const user = this.users.get(userId);
    return user ? { used: user.used, resetAt: user.resetAt } : null;
  }

  async resetIfDue(userId: string, now: Date, nextResetAt: string): Promise<CounterSnapshot | null> {
    await tick();
    const user = this.users.get(userId);
    if (!user || Date.parse(user.resetAt) > now.getTime()) return null;
    user.used = 0;
    user.legacy = 0;
    user.resetAt = nextResetAt;
    return { used: 0, resetAt: nextResetAt };
  }

  async compareAndSet(userId: string, expected: number, next: number): Promise<boolean> {
    this.beforeWrite?.();
    await tick();
    this.writes++;
    const user = this.users.get(userId);
    if (!user || user.used !== expected) return false;
    user.used = next;
    return true;
  }
}

const NOW = new Date('2026-10-05T12:00:00Z');
const OCTOBER_RESET = '2026-11-01T00:00:00.000Z';

describe('nextMonthlyResetAt / isResetDue', () => {
  it('resets on the first day of the next month, UTC', () => {
    expect(nextMonthlyResetAt(NOW)).toBe(OCTOBER_RESET);
    expect(nextMonthlyResetAt(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01T00:00:00.000Z');
    expect(nextMonthlyResetAt(new Date('2026-01-31T10:00:00Z'))).toBe('2026-02-01T00:00:00.000Z');
  });

  it('is due once the reset date has passed', () => {
    expect(isResetDue('2026-10-01T00:00:00Z', NOW)).toBe(true);
    expect(isResetDue(NOW.toISOString(), NOW)).toBe(true);
    expect(isResetDue(OCTOBER_RESET, NOW)).toBe(false);
    expect(isResetDue('not a date', NOW)).toBe(true);
  });
});

describe('checkEmailQuota', () => {
  /** Entitlements of a plan whose trial (if any) ends a week after NOW. */
  const entitlementsOf = (plan: string, trialEndsAt = '2026-10-12T12:00:00Z') =>
    getEntitlements({ plan, trial_ends_at: trialEndsAt }, NOW);

  it('lets every plan in force send, within its cap from lib/plans.ts', () => {
    for (const plan of Object.keys(PLAN_LIMITS) as PlanType[]) {
      const cap = getPlanEmailLimit(plan);
      expect(checkEmailQuota(entitlementsOf(plan), 0)).toBe('ok');
      expect(checkEmailQuota(entitlementsOf(plan), cap - 1)).toBe('ok');
    }
    expect(checkEmailQuota(entitlementsOf('cancelled'), 0)).toBe('plan');
  });

  it('refuses once the monthly cap is reached', () => {
    const cap = getPlanEmailLimit('basic');
    expect(checkEmailQuota(entitlementsOf('basic'), cap - 1)).toBe('ok');
    expect(checkEmailQuota(entitlementsOf('basic'), cap)).toBe('monthly_cap');
    expect(checkEmailQuota(entitlementsOf('basic'), cap + 10)).toBe('monthly_cap');
  });

  it('gives a running trial its own small cap', () => {
    expect(checkEmailQuota(entitlementsOf('trial'), TRIAL_EMAIL_LIMIT - 1)).toBe('ok');
    expect(checkEmailQuota(entitlementsOf('trial'), TRIAL_EMAIL_LIMIT)).toBe('trial_cap');
  });

  it('refuses an ended trial, whatever the counter says', () => {
    const ended = entitlementsOf('trial', '2026-10-05T11:59:59Z');
    expect(checkEmailQuota(ended, 0)).toBe('plan');
  });

  it('treats a plan that is not known as a plan without email', () => {
    expect(checkEmailQuota(entitlementsOf('gold'), 0)).toBe('plan');
    expect(checkEmailQuota(entitlementsOf(''), 0)).toBe('plan');
  });

  it('reads legacy plan names as their current plan', () => {
    expect(checkEmailQuota(entitlementsOf('solo-sms'), 0)).toBe('ok');
    expect(checkEmailQuota(entitlementsOf('starter'), getPlanEmailLimit('basic'))).toBe('monthly_cap');
  });
});

describe('refreshMonthlyPeriod', () => {
  it('leaves the counter alone before the reset date', async () => {
    const store = new MemoryCounterStore(42, OCTOBER_RESET);
    const snapshot = { used: 42, resetAt: OCTOBER_RESET };
    expect(await refreshMonthlyPeriod(store, 'u1', snapshot, NOW)).toBe(snapshot);
    expect(store.get().used).toBe(42);
  });

  it('resets both counters on the first send of a new month', async () => {
    const store = new MemoryCounterStore(1999, '2026-10-01T00:00:00.000Z');
    const counter = await refreshMonthlyPeriod(store, 'u1', { used: 1999, resetAt: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(counter).toEqual({ used: 0, resetAt: OCTOBER_RESET });
    expect(store.get()).toEqual({ used: 0, legacy: 0, resetAt: OCTOBER_RESET });
  });

  it('reads the current values when another request reset first, keeping its sends', async () => {
    const store = new MemoryCounterStore(2, OCTOBER_RESET);
    // This request still holds last month's values.
    const counter = await refreshMonthlyPeriod(store, 'u1', { used: 1500, resetAt: '2026-10-01T00:00:00.000Z' }, NOW);
    expect(counter).toEqual({ used: 2, resetAt: OCTOBER_RESET });
    expect(store.get().used).toBe(2);
  });
});

describe('counterRetryDelayMs', () => {
  it('waits a random time under a ceiling that doubles and is capped', () => {
    const almostOne = () => 0.999;
    expect(counterRetryDelayMs(1, () => 0)).toBe(0);
    expect(counterRetryDelayMs(1, almostOne)).toBe(19);
    expect(counterRetryDelayMs(2, almostOne)).toBe(39);
    expect(counterRetryDelayMs(3, almostOne)).toBe(79);
    expect(counterRetryDelayMs(4, almostOne)).toBe(159);
    expect(counterRetryDelayMs(5, almostOne)).toBe(199);
    expect(counterRetryDelayMs(COUNTER_UPDATE_ATTEMPTS, almostOne)).toBe(199);
  });
});

describe('incrementEmailCounter', () => {
  /** Retries without real waiting, still letting concurrent work interleave. */
  const fast = { sleep: () => tick() };

  it('adds one when nothing changed meanwhile', async () => {
    const store = new MemoryCounterStore(7, OCTOBER_RESET);
    const result = await incrementEmailCounter(store, 'u1', { used: 7, resetAt: OCTOBER_RESET }, fast);
    expect(result).toEqual({ ok: true, counter: { used: 8, resetAt: OCTOBER_RESET } });
    expect(store.get().used).toBe(8);
    expect(store.writes).toBe(1);
  });

  it('re-reads and retries after a stale read instead of overwriting', async () => {
    const store = new MemoryCounterStore(9, OCTOBER_RESET);
    // Read as 7, but two other sends counted since.
    const result = await incrementEmailCounter(store, 'u1', { used: 7, resetAt: OCTOBER_RESET }, fast);
    expect(result.ok).toBe(true);
    expect(store.get().used).toBe(10);
  });

  it('keeps every increment when others write between read and update', async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    let interruptions = 2;
    store.beforeWrite = () => {
      if (interruptions > 0) {
        interruptions--;
        store.get().used++; // another request's increment lands first
      }
    };
    const result = await incrementEmailCounter(store, 'u1', { used: 0, resetAt: OCTOBER_RESET }, fast);
    expect(result.ok).toBe(true);
    expect(store.get().used).toBe(3);
  });

  it('backs off with a growing random delay between attempts', async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    let interruptions = 3;
    store.beforeWrite = () => {
      if (interruptions-- > 0) store.get().used++;
    };
    const delays: number[] = [];
    const result = await incrementEmailCounter(store, 'u1', { used: 0, resetAt: OCTOBER_RESET }, {
      sleep: async (ms) => { delays.push(ms); },
      random: () => 0.5,
    });
    expect(result.ok).toBe(true);
    expect(delays).toEqual([10, 20, 40]);
  });

  it(`does not lose updates when ${COUNTER_UPDATE_ATTEMPTS - 1} sends finish at the same moment`, async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    // Every send read the counter before any of them incremented it.
    const snapshot = { used: 0, resetAt: OCTOBER_RESET };
    const sends = COUNTER_UPDATE_ATTEMPTS - 1;
    const results = await Promise.all(
      Array.from({ length: sends }, () => incrementEmailCounter(store, 'u1', snapshot, fast)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.get().used).toBe(sends);
  });

  it('keeps 8 parallel sends with the real backoff', async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    const snapshot = { used: 0, resetAt: OCTOBER_RESET };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => incrementEmailCounter(store, 'u1', snapshot)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.get().used).toBe(8);
  });

  it('gives up after the maximum attempts under constant contention', async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    store.beforeWrite = () => { store.get().used++; };
    const result = await incrementEmailCounter(store, 'u1', { used: 0, resetAt: OCTOBER_RESET }, fast);
    expect(result.ok).toBe(false);
    expect(store.writes).toBe(COUNTER_UPDATE_ATTEMPTS);
  });

  it('stops when the user no longer exists', async () => {
    const store = new MemoryCounterStore(0, OCTOBER_RESET);
    store.users.clear();
    const result = await incrementEmailCounter(store, 'u1', { used: 0, resetAt: OCTOBER_RESET }, fast);
    expect(result.ok).toBe(false);
    expect(store.writes).toBe(1);
  });
});
