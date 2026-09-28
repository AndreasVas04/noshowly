/**
 * lib/__tests__/reminder-claim.test.ts
 *
 * Unit tests for claiming the 24-hour reminder (lib/reminders/claim.ts)
 * against an in-memory ClaimStore: with and without the unique index,
 * overlapping runs, stale claims and database errors.
 */

import { describe, expect, it } from 'vitest';
import { claimDailyReminder, type ClaimStore, type InsertClaimResult } from '@/lib/reminders/claim';

type Row = {
  id: string;
  appointment_id: string;
  type: string;
  status: string;
  token: string | null;
  created_at: string;
};

/** Lets other pending async work run, so concurrent claims interleave. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * In-memory reminders table. `uniqueIndex` mimics
 * reminders_one_email_per_appointment (one pending or sent 'email' row per
 * appointment); rows get increasing created_at values.
 */
class MemoryClaimStore implements ClaimStore {
  rows: Row[] = [];
  private seq = 0;
  failOn: 'retire' | 'insert' | 'load' | null = null;

  constructor(private readonly uniqueIndex: boolean) {}

  add(row: Partial<Row> & { id: string }): void {
    this.rows.push({
      appointment_id: 'a1',
      type: 'email',
      status: 'pending',
      token: `token-${row.id}`,
      created_at: this.nextTimestamp(),
      ...row,
    });
  }

  private nextTimestamp(): string {
    this.seq++;
    return new Date(Date.UTC(2026, 9, 5, 12, 0, this.seq)).toISOString();
  }

  async retirePendingClaims(ids: readonly string[]): Promise<number> {
    await tick();
    if (this.failOn === 'retire') throw new Error('retire failed');
    let changed = 0;
    for (const row of this.rows) {
      if (ids.includes(row.id) && row.type === 'email' && row.status === 'pending') {
        row.status = 'failed';
        changed++;
      }
    }
    return changed;
  }

  async insertClaim(input: { appointmentId: string; token: string; sendAt: string }): Promise<InsertClaimResult> {
    await tick();
    if (this.failOn === 'insert') throw new Error('insert failed');
    const blocked = this.uniqueIndex && this.rows.some(
      (r) => r.appointment_id === input.appointmentId && r.type === 'email' && (r.status === 'pending' || r.status === 'sent'),
    );
    if (blocked) return { ok: false, duplicate: true, message: 'duplicate key value violates unique constraint' };
    const row: Row = {
      id: `claim-${this.seq + 1}`,
      appointment_id: input.appointmentId,
      type: 'email',
      status: 'pending',
      token: input.token,
      created_at: this.nextTimestamp(),
    };
    this.rows.push(row);
    return { ok: true, row: { id: row.id, status: row.status, created_at: row.created_at } };
  }

  async loadLiveClaims(appointmentId: string) {
    await tick();
    if (this.failOn === 'load') throw new Error('load failed');
    return this.rows
      .filter((r) => r.appointment_id === appointmentId && r.type === 'email'
        && (r.status === 'pending' || r.status === 'sent') && r.token !== null)
      .map((r) => ({ id: r.id, status: r.status, created_at: r.created_at }));
  }

  async markSkipped(id: string): Promise<void> {
    await tick();
    const row = this.rows.find((r) => r.id === id && r.status === 'pending');
    if (row) row.status = 'skipped';
  }

  /** Rows of the appointment that would send. */
  live(): Row[] {
    return this.rows.filter((r) => r.type === 'email' && (r.status === 'pending' || r.status === 'sent'));
  }
}

const NOW = new Date('2026-10-05T12:00:00Z');

function claim(store: ClaimStore, staleClaimIds: string[] = [], token = 'new-token') {
  return claimDailyReminder(store, { appointmentId: 'a1', token, staleClaimIds, now: NOW });
}

describe('claimDailyReminder', () => {
  it('inserts a pending claim before anything is sent', async () => {
    const store = new MemoryClaimStore(true);
    const result = await claim(store);
    expect(result.ok).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'pending', token: 'new-token', type: 'email' });
  });

  it('treats a unique violation (23505) as already claimed', async () => {
    const store = new MemoryClaimStore(true);
    store.add({ id: 'existing', status: 'sent' });
    expect(await claim(store)).toEqual({ ok: false, reason: 'already_claimed' });
    expect(store.rows).toHaveLength(1);
  });

  it('without the index, backs off when an older live claim exists', async () => {
    const store = new MemoryClaimStore(false);
    store.add({ id: 'older' });
    expect(await claim(store)).toEqual({ ok: false, reason: 'already_claimed' });
    expect(store.live().map((r) => r.id)).toEqual(['older']);
    expect(store.rows.find((r) => r.id !== 'older')?.status).toBe('skipped');
  });

  it('without the index, backs off when the reminder was already sent', async () => {
    const store = new MemoryClaimStore(false);
    store.add({ id: 'sent', status: 'sent' });
    expect(await claim(store)).toEqual({ ok: false, reason: 'already_claimed' });
    expect(store.live().map((r) => r.id)).toEqual(['sent']);
  });

  it('ignores token-less rows from the old booking route', async () => {
    const store = new MemoryClaimStore(false);
    store.add({ id: 'orphan', token: null });
    expect((await claim(store)).ok).toBe(true);
  });

  for (const uniqueIndex of [true, false]) {
    it(`lets exactly one of two overlapping runs claim (unique index: ${uniqueIndex})`, async () => {
      const store = new MemoryClaimStore(uniqueIndex);
      const results = await Promise.all([claim(store, [], 'run-a'), claim(store, [], 'run-b')]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'already_claimed' }]);
      expect(store.live()).toHaveLength(1);
    });
  }

  it('retires a stale claim as failed and claims again', async () => {
    const store = new MemoryClaimStore(true);
    store.add({ id: 'stale' });
    const result = await claim(store, ['stale']);
    expect(result.ok).toBe(true);
    expect(store.rows.find((r) => r.id === 'stale')?.status).toBe('failed');
    expect(store.live()).toHaveLength(1);
  });

  it('backs off when another run retired the stale claim first', async () => {
    const store = new MemoryClaimStore(false);
    store.add({ id: 'stale', status: 'failed' });
    expect(await claim(store, ['stale'])).toEqual({ ok: false, reason: 'already_claimed' });
    expect(store.rows).toHaveLength(1);
  });

  it('lets exactly one of two runs retry the same stale claim', async () => {
    const store = new MemoryClaimStore(false);
    store.add({ id: 'stale' });
    const results = await Promise.all([claim(store, ['stale'], 'run-a'), claim(store, ['stale'], 'run-b')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(store.live()).toHaveLength(1);
  });

  it('reports database errors', async () => {
    for (const failOn of ['retire', 'insert'] as const) {
      const store = new MemoryClaimStore(true);
      store.add({ id: 'stale' });
      store.failOn = failOn;
      const result = await claim(store, ['stale']);
      expect(result).toMatchObject({ ok: false, reason: 'database' });
    }
  });

  it('gives its claim up when the claims cannot be read back', async () => {
    const store = new MemoryClaimStore(false);
    store.failOn = 'load';
    expect(await claim(store)).toMatchObject({ ok: false, reason: 'database', message: 'load failed' });
    expect(store.rows[0].status).toBe('skipped');
  });
});
