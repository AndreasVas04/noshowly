/**
 * lib/__tests__/account-setup.test.ts
 *
 * Unit tests for creating an account's rows (lib/account.ts ensureAccount and
 * accountSetupFromMetadata) against a fake Supabase client with in-memory
 * users and salons tables: fresh sign-ups, repeated calls, half-created
 * accounts, concurrent requests with and without salons_user_id_key, and
 * database errors.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SALON_NAME,
  accountSetupFromMetadata,
  ensureAccount,
} from '@/lib/account';

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
type Op = 'select' | 'insert' | 'delete';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const SETUP = { salonName: 'Salon Elena', timezone: 'Europe/Nicosia' };

/**
 * In-memory users and salons tables behind the subset of the Supabase query
 * builder ensureAccount() uses.
 */
class FakeDb {
  tables: Record<string, Row[]> = { users: [], salons: [] };
  /** salons_user_id_key: one salon per owner (added by the data_integrity migration). */
  uniqueSalonPerUser = true;
  /** One-shot errors, by table and operation, after `skip` matching operations succeed. */
  failures: Array<{ table: string; op: Op; error: DbError; skip?: number }> = [];
  /** Runs before each insert, e.g. to let a "concurrent request" insert first. */
  beforeInsert: ((table: string) => void) | null = null;
  inserts = 0;
  private seq = 0;

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /** Adds a row like the database would (ids and increasing created_at for salons). */
  add(table: string, row: Row): Row {
    this.seq++;
    const stored = table === 'salons'
      ? { id: `salon-${this.seq}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, this.seq)).toISOString(), ...row }
      : { ...row };
    this.tables[table].push(stored);
    return stored;
  }

  takeFailure(table: string, op: Op): DbError | null {
    const index = this.failures.findIndex((f) => f.table === table && f.op === op);
    if (index === -1) return null;
    const failure = this.failures[index];
    if (failure.skip) {
      failure.skip--;
      return null;
    }
    return this.failures.splice(index, 1)[0].error;
  }
}

/** A thenable query: select/insert/delete with eq, order, limit, single and maybeSingle. */
class FakeQuery implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: Op = 'select';
  private filters: Array<[string, unknown]> = [];
  private orders: Array<[string, boolean]> = [];
  private limitCount: number | null = null;
  private payload: Row | null = null;
  private returning = false;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select() { if (this.op === 'insert') this.returning = true; return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order(column: string, options: { ascending: boolean }) { this.orders.push([column, options.ascending]); return this; }
  limit(count: number) { this.limitCount = count; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this; }

  then<A = { data: unknown; error: DbError | null }, B = never>(
    onFulfilled?: ((value: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private run(): { data: unknown; error: DbError | null } {
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.db.tables[this.table];

    if (this.op === 'insert') {
      this.db.beforeInsert?.(this.table);
      const row = this.payload!;
      const duplicate = this.table === 'users'
        ? rows.some((r) => r.id === row.id)
        : this.db.uniqueSalonPerUser && rows.some((r) => r.user_id === row.user_id);
      if (duplicate) return { data: null, error: { message: 'duplicate key value', code: '23505' } };
      this.db.inserts++;
      const stored = this.db.add(this.table, row);
      return { data: this.returning ? { id: stored.id } : null, error: null };
    }

    if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter((r) => !this.matches(r));
      return { data: null, error: null };
    }

    let found = rows.filter((r) => this.matches(r));
    for (const [column, ascending] of [...this.orders].reverse()) {
      found = [...found].sort((a, b) => {
        const order = String(a[column]).localeCompare(String(b[column]));
        return ascending ? order : -order;
      });
    }
    if (this.limitCount !== null) found = found.slice(0, this.limitCount);
    if (this.mode === 'many') return { data: found, error: null };
    return { data: found[0] ?? null, error: null };
  }
}

/** The fake as the Supabase client type ensureAccount() expects. */
const asClient = (db: FakeDb) => db as unknown as Parameters<typeof ensureAccount>[0];

describe('ensureAccount', () => {
  it('creates the users row on the trial and the salon for a new sign-up', async () => {
    const db = new FakeDb();
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: true, createdSalon: true });
    expect(db.tables.users).toEqual([{ id: USER.id, email: USER.email, plan: 'trial' }]);
    expect(db.tables.salons).toHaveLength(1);
    expect(db.tables.salons[0]).toMatchObject({ user_id: USER.id, name: 'Salon Elena', timezone: 'Europe/Nicosia' });
  });

  it('changes nothing when called again', async () => {
    const db = new FakeDb();
    await ensureAccount(asClient(db), USER, SETUP);
    const inserts = db.inserts;
    expect(await ensureAccount(asClient(db), USER, { salonName: 'Other', timezone: 'UTC' }))
      .toEqual({ ok: true, createdUser: false, createdSalon: false });
    expect(db.inserts).toBe(inserts);
    expect(db.tables.salons).toHaveLength(1);
    expect(db.tables.salons[0].name).toBe('Salon Elena');
  });

  it('completes an account that has a users row but no salon, leaving the plan alone', async () => {
    const db = new FakeDb();
    db.add('users', { id: USER.id, email: USER.email, plan: 'basic' });
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: false, createdSalon: true });
    expect(db.tables.users).toEqual([{ id: USER.id, email: USER.email, plan: 'basic' }]);
    expect(db.tables.salons).toHaveLength(1);
  });

  it('completes an account that has a salon but no users row', async () => {
    const db = new FakeDb();
    db.add('salons', { user_id: USER.id, name: 'Existing', timezone: 'UTC' });
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: true, createdSalon: false });
    expect(db.tables.salons).toHaveLength(1);
    expect(db.tables.salons[0].name).toBe('Existing');
  });

  it('treats a unique violation as "another request created it first"', async () => {
    const db = new FakeDb();
    db.beforeInsert = (table) => {
      // A concurrent request inserts the same row a moment earlier.
      if (table === 'users' && db.tables.users.length === 0) db.add('users', { id: USER.id, email: USER.email, plan: 'trial' });
      if (table === 'salons' && db.tables.salons.length === 0) db.add('salons', { user_id: USER.id, name: 'Salon Elena', timezone: 'UTC' });
    };
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: false, createdSalon: false });
    expect(db.tables.users).toHaveLength(1);
    expect(db.tables.salons).toHaveLength(1);
  });

  it('removes its own salon when a racing request created one first and nothing prevents duplicates', async () => {
    const db = new FakeDb();
    db.uniqueSalonPerUser = false;
    db.add('users', { id: USER.id, email: USER.email, plan: 'trial' });
    db.beforeInsert = (table) => {
      if (table === 'salons' && db.tables.salons.length === 0) {
        db.add('salons', { user_id: USER.id, name: 'From the other request', timezone: 'UTC' });
      }
    };
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: false, createdSalon: false });
    expect(db.tables.salons).toHaveLength(1);
    expect(db.tables.salons[0].name).toBe('From the other request');
  });

  it('reports the step that failed and finishes on the next call', async () => {
    const db = new FakeDb();
    db.failures.push({ table: 'salons', op: 'insert', error: { message: 'timeout' } });
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: false, step: 'salons', message: 'timeout' });
    expect(db.tables.users).toHaveLength(1);
    expect(db.tables.salons).toHaveLength(0);

    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: false, createdSalon: true });
    expect(db.tables.salons).toHaveLength(1);
  });

  it('stops before creating anything when the users lookup fails', async () => {
    const db = new FakeDb();
    db.failures.push({ table: 'users', op: 'select', error: { message: 'connection refused' } });
    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: false, step: 'users', message: 'connection refused' });
    expect(db.inserts).toBe(0);
  });

  it('refuses a users row without an email address', async () => {
    const db = new FakeDb();
    const result = await ensureAccount(asClient(db), { id: USER.id, email: null }, SETUP);
    expect(result).toMatchObject({ ok: false, step: 'users' });
    expect(db.inserts).toBe(0);
  });

  it('keeps the new salon when the duplicate check after inserting it fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = new FakeDb();
    db.add('users', { id: USER.id, email: USER.email, plan: 'trial' });
    // The first salons select is the lookup; the second (the duplicate check) fails.
    db.failures.push({ table: 'salons', op: 'select', skip: 1, error: { message: 'timeout' } });

    expect(await ensureAccount(asClient(db), USER, SETUP)).toEqual({ ok: true, createdUser: false, createdSalon: true });
    expect(db.tables.salons).toHaveLength(1);
    expect(error).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('accountSetupFromMetadata', () => {
  it('uses the salon name and time zone recorded at sign-up', () => {
    expect(accountSetupFromMetadata({ user_metadata: { salon_name: '  Salon Elena ', timezone: 'Europe/Nicosia' } }))
      .toEqual({ salonName: 'Salon Elena', timezone: 'Europe/Nicosia' });
  });

  it('falls back to the default name and UTC', () => {
    expect(accountSetupFromMetadata({ user_metadata: {} })).toEqual({ salonName: DEFAULT_SALON_NAME, timezone: 'UTC' });
    expect(accountSetupFromMetadata({})).toEqual({ salonName: DEFAULT_SALON_NAME, timezone: 'UTC' });
    expect(accountSetupFromMetadata({ user_metadata: { salon_name: '   ', timezone: 'Mars/Olympus' } }))
      .toEqual({ salonName: DEFAULT_SALON_NAME, timezone: 'UTC' });
    expect(accountSetupFromMetadata({ user_metadata: { salon_name: 42, timezone: 7 } }))
      .toEqual({ salonName: DEFAULT_SALON_NAME, timezone: 'UTC' });
  });

  it('shortens a name longer than 100 characters', () => {
    expect(accountSetupFromMetadata({ user_metadata: { salon_name: 'x'.repeat(150) } }).salonName).toHaveLength(100);
  });
});
