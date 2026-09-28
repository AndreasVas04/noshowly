/**
 * lib/__tests__/reminder-store.test.ts
 *
 * Unit tests for the reminders queries in lib/reminders/store.ts that decide
 * behaviour through their filters, run against a fake Supabase client that
 * records the query it is given.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { cancelReminderLinks } from '@/lib/reminders/store';

type Call = { method: string; args: unknown[] };

/**
 * A stand-in for the Supabase query builder: every method records its call
 * and returns the builder; awaiting it resolves to `result`.
 */
function recordingClient(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of [
    'from', 'select', 'update', 'insert', 'eq', 'in', 'not', 'or', 'is', 'gt', 'gte', 'lte',
    'ilike', 'order', 'range', 'limit', 'single', 'maybeSingle',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: result.data ?? null, error: result.error ?? null, count: null });
  return { client: builder as unknown as SupabaseClient<Database>, calls };
}

describe('cancelReminderLinks', () => {
  it('retires pending, sent and answered 24-hour reminders and booking confirmations', async () => {
    const { client, calls } = recordingClient();
    expect(await cancelReminderLinks(client, 'appt-1')).toBeNull();

    expect(calls[0]).toEqual({ method: 'from', args: ['reminders'] });
    expect(calls).toContainEqual({ method: 'update', args: [{ status: 'cancelled' }] });
    expect(calls).toContainEqual({ method: 'eq', args: ['appointment_id', 'appt-1'] });
    expect(calls).toContainEqual({ method: 'in', args: ['type', ['email', 'email_confirmation']] });
    expect(calls).toContainEqual({ method: 'in', args: ['status', ['pending', 'sent', 'confirmed']] });
  });

  it('returns the database error instead of throwing', async () => {
    const { client } = recordingClient({ error: { message: 'permission denied' } });
    expect(await cancelReminderLinks(client, 'appt-1')).toBe('permission denied');
  });
});
