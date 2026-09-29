/**
 * lib/__tests__/entitlements.test.ts
 *
 * Unit tests for lib/entitlements.ts (what an account may do: the trial and
 * its end date, paid plans, cancelled, legacy and unknown plan values) and
 * for requireWriteAccess() in lib/access.ts against a fake users table.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_LIMITS, TRIAL_EMAIL_LIMIT } from '@/lib/plans';
import {
  SUBSCRIPTION_INACTIVE_MESSAGE,
  TRIAL_ENDED_MESSAGE,
  accessDenial,
  getEntitlements,
  parsePlan,
  planLabel,
} from '@/lib/entitlements';
import { ACCOUNT_INCOMPLETE_MESSAGE, requireWriteAccess } from '@/lib/access';

const NOW = new Date('2026-10-05T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** trial_ends_at `ms` milliseconds after NOW (negative: before). */
const endsIn = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePlan', () => {
  it('keeps the current plan names', () => {
    for (const plan of ['trial', 'basic', 'pro', 'business', 'cancelled']) {
      expect(parsePlan(plan)).toBe(plan);
    }
    expect(parsePlan(' Basic ')).toBe('basic');
  });

  it('maps legacy names the way the data_integrity migration renames them, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePlan('starter')).toBe('basic');
    expect(parsePlan('professional')).toBe('pro');
    for (const legacy of ['solo-sms', 'team-email', 'studio-both']) {
      expect(parsePlan(legacy)).toBe('basic');
    }
    expect(warn).toHaveBeenCalled();
  });

  it("treats unknown or missing values as 'cancelled' and logs them once", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parsePlan('platinum')).toBe('cancelled');
    expect(parsePlan('platinum')).toBe('cancelled');
    expect(error).toHaveBeenCalledTimes(1);

    expect(parsePlan(null)).toBe('cancelled');
    expect(parsePlan(undefined)).toBe('cancelled');
    expect(parsePlan(42)).toBe('cancelled');
    expect(parsePlan('')).toBe('cancelled');
  });

  it('is not fooled by object property names', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parsePlan('constructor')).toBe('cancelled');
    expect(parsePlan('__proto__')).toBe('cancelled');
    expect(parsePlan('toString')).toBe('cancelled');
  });
});

describe('getEntitlements — trial', () => {
  it('gives a running trial full access with the small trial email cap', () => {
    const e = getEntitlements({ plan: 'trial', trial_ends_at: endsIn(10 * DAY_MS) }, NOW);
    expect(e).toEqual({
      plan: 'trial',
      isPaid: false,
      isTrial: true,
      trialEndsAt: endsIn(10 * DAY_MS),
      trialDaysLeft: 10,
      trialExpired: false,
      canWrite: true,
      canSendEmail: true,
      emailMonthlyLimit: TRIAL_EMAIL_LIMIT,
    });
  });

  it('ends the trial exactly at trial_ends_at', () => {
    const lastMoment = getEntitlements({ plan: 'trial', trial_ends_at: endsIn(1) }, NOW);
    expect(lastMoment.trialExpired).toBe(false);
    expect(lastMoment.canWrite).toBe(true);
    expect(lastMoment.trialDaysLeft).toBe(1);

    const atEnd = getEntitlements({ plan: 'trial', trial_ends_at: endsIn(0) }, NOW);
    expect(atEnd.trialExpired).toBe(true);
    expect(atEnd.canWrite).toBe(false);
    expect(atEnd.canSendEmail).toBe(false);
    expect(atEnd.emailMonthlyLimit).toBe(0);
    expect(atEnd.trialDaysLeft).toBe(0);
  });

  it('makes an ended trial read-only', () => {
    const e = getEntitlements({ plan: 'trial', trial_ends_at: endsIn(-3 * DAY_MS) }, NOW);
    expect(e).toMatchObject({
      isTrial: true,
      isPaid: false,
      trialExpired: true,
      trialDaysLeft: 0,
      canWrite: false,
      canSendEmail: false,
      emailMonthlyLimit: 0,
    });
  });

  it('counts the days left in whole days, rounded up', () => {
    const days = (ms: number) => getEntitlements({ plan: 'trial', trial_ends_at: endsIn(ms) }, NOW).trialDaysLeft;
    expect(days(14 * DAY_MS)).toBe(14);
    expect(days(14 * DAY_MS - 60_000)).toBe(14);
    expect(days(DAY_MS + 1)).toBe(2);
    expect(days(DAY_MS)).toBe(1);
    expect(days(60_000)).toBe(1);
  });

  it('treats a trial without a readable end date as ended (fail closed)', () => {
    for (const trialEndsAt of [null, undefined, '', 'not a date']) {
      const e = getEntitlements({ plan: 'trial', trial_ends_at: trialEndsAt }, NOW);
      expect(e.trialExpired).toBe(true);
      expect(e.canWrite).toBe(false);
      expect(e.trialEndsAt).toBeNull();
    }
  });
});

describe('getEntitlements — paid, cancelled, legacy and unknown plans', () => {
  it('gives paid plans full access with their fair-use caps, whatever the trial date', () => {
    for (const plan of ['basic', 'pro', 'business'] as const) {
      const e = getEntitlements({ plan, trial_ends_at: endsIn(-100 * DAY_MS) }, NOW);
      expect(e).toMatchObject({
        plan,
        isPaid: true,
        isTrial: false,
        trialExpired: false,
        trialDaysLeft: null,
        canWrite: true,
        canSendEmail: true,
        emailMonthlyLimit: PLAN_LIMITS[plan].email,
      });
    }
  });

  it("makes 'cancelled' read-only, even when the old trial date is still ahead", () => {
    const e = getEntitlements({ plan: 'cancelled', trial_ends_at: endsIn(5 * DAY_MS) }, NOW);
    expect(e).toMatchObject({
      plan: 'cancelled',
      isPaid: false,
      isTrial: false,
      trialDaysLeft: null,
      canWrite: false,
      canSendEmail: false,
      emailMonthlyLimit: 0,
    });
  });

  it('reads legacy plans as their current plan', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getEntitlements({ plan: 'starter', trial_ends_at: null }, NOW)).toMatchObject({
      plan: 'basic',
      isPaid: true,
      canWrite: true,
      emailMonthlyLimit: PLAN_LIMITS.basic.email,
    });
    expect(getEntitlements({ plan: 'professional', trial_ends_at: null }, NOW).plan).toBe('pro');
  });

  it('gives an unknown plan no access', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getEntitlements({ plan: 'enterprise', trial_ends_at: endsIn(DAY_MS) }, NOW)).toMatchObject({
      plan: 'cancelled',
      isPaid: false,
      canWrite: false,
      canSendEmail: false,
    });
  });
});

describe('accessDenial and planLabel', () => {
  it('explains why an account is read-only', () => {
    const ended = getEntitlements({ plan: 'trial', trial_ends_at: endsIn(-1) }, NOW);
    expect(accessDenial(ended)).toEqual({ code: 'trial_ended', message: TRIAL_ENDED_MESSAGE });

    const cancelled = getEntitlements({ plan: 'cancelled', trial_ends_at: null }, NOW);
    expect(accessDenial(cancelled)).toEqual({ code: 'subscription_inactive', message: SUBSCRIPTION_INACTIVE_MESSAGE });

    expect(accessDenial(getEntitlements({ plan: 'basic', trial_ends_at: null }, NOW))).toBeNull();
    expect(accessDenial(getEntitlements({ plan: 'trial', trial_ends_at: endsIn(DAY_MS) }, NOW))).toBeNull();
  });

  it('names plans for the owner', () => {
    expect(planLabel('trial')).toBe('Free trial');
    expect(planLabel('basic')).toBe('Basic');
    expect(planLabel('cancelled')).toBe('Inactive');
  });
});

// ---------------------------------------------------------------------------
// requireWriteAccess (lib/access.ts)
// ---------------------------------------------------------------------------

type UsersRow = { plan: string; trial_ends_at: string | null; stripe_customer_id: string | null };

/**
 * Fake Supabase client answering
 * from('users').select(...).eq('id', id).maybeSingle().
 */
function fakeUsersDb(rows: Record<string, UsersRow>, failWith: string | null = null) {
  return {
    from(table: string) {
      expect(table).toBe('users');
      let id = '';
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => { id = value; return builder; },
        maybeSingle: async () =>
          failWith
            ? { data: null, error: { message: failWith } }
            : { data: rows[id] ?? null, error: null },
      };
      return builder;
    },
  } as unknown as Parameters<typeof requireWriteAccess>[0];
}

describe('requireWriteAccess', () => {
  const rows: Record<string, UsersRow> = {
    paid:      { plan: 'basic', trial_ends_at: endsIn(-DAY_MS), stripe_customer_id: 'cus_1' },
    trial:     { plan: 'trial', trial_ends_at: endsIn(DAY_MS), stripe_customer_id: null },
    ended:     { plan: 'trial', trial_ends_at: endsIn(-DAY_MS), stripe_customer_id: null },
    cancelled: { plan: 'cancelled', trial_ends_at: endsIn(-DAY_MS), stripe_customer_id: 'cus_2' },
  };

  it('lets paid plans and running trials write', async () => {
    for (const id of ['paid', 'trial']) {
      const result = await requireWriteAccess(fakeUsersDb(rows), id, NOW);
      expect(result.ok).toBe(true);
    }
  });

  it('answers 403 with the same message everywhere for an ended trial', async () => {
    const result = await requireWriteAccess(fakeUsersDb(rows), 'ended', NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: TRIAL_ENDED_MESSAGE, code: 'trial_ended' });
  });

  it('answers 403 for an inactive subscription', async () => {
    const result = await requireWriteAccess(fakeUsersDb(rows), 'cancelled', NOW);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: SUBSCRIPTION_INACTIVE_MESSAGE,
      code: 'subscription_inactive',
    });
  });

  it('answers 403 when the users row is missing', async () => {
    const result = await requireWriteAccess(fakeUsersDb(rows), 'missing', NOW);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: ACCOUNT_INCOMPLETE_MESSAGE, code: 'account_incomplete' });
  });

  it('fails closed with 500 when the plan cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await requireWriteAccess(fakeUsersDb(rows, 'connection reset'), 'paid', NOW);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.response.status).toBe(500);
  });
});
