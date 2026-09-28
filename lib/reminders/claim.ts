/**
 * lib/reminders/claim.ts
 *
 * Claims an appointment's 24-hour reminder ('email') so it is sent once, even
 * when two reminder runs overlap.
 *
 * The claim is a 'pending' reminders row inserted BEFORE the email is sent:
 *  1. Stale claims (see STALE_CLAIM_AFTER_MS in lib/reminders/rules.ts) are
 *     marked 'failed'. If one is no longer 'pending', another run got to it
 *     first and this run backs off.
 *  2. The claim row is inserted. With the unique index
 *     reminders_one_email_per_appointment (one pending or sent 'email' row
 *     per appointment) a second claim fails with 23505: already claimed.
 *  3. Until that index exists, two runs can both insert a claim, so the live
 *     claims are read back and only the oldest proceeds (wonClaimRace()).
 *     The other claim is marked 'skipped'.
 *
 * The database is reached through the ClaimStore interface
 * (lib/reminders/store.ts implements it with Supabase), so the logic can be
 * tested without a database.
 */

import { wonClaimRace } from '@/lib/reminders/rules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A claim row as read back. */
export type ClaimRow = { id: string; status: string; created_at: string };

/** Result of ClaimStore.insertClaim(). */
export type InsertClaimResult =
  | { ok: true; row: ClaimRow }
  | { ok: false; duplicate: boolean; message: string };

/** Database operations used to claim a 24-hour reminder. Methods throw on database errors. */
export interface ClaimStore {
  /** Marks 'pending' claims as 'failed'; returns how many were still 'pending'. */
  retirePendingClaims(ids: readonly string[]): Promise<number>;
  /** Inserts a 'pending' 'email' row; duplicate is true for a unique violation (23505). */
  insertClaim(input: { appointmentId: string; token: string; sendAt: string }): Promise<InsertClaimResult>;
  /** The appointment's 'email' rows that are 'pending' or 'sent' and have a token. */
  loadLiveClaims(appointmentId: string): Promise<ClaimRow[]>;
  /** Marks a 'pending' row as 'skipped'. */
  markSkipped(id: string): Promise<void>;
}

/** Result of claimDailyReminder(). */
export type ClaimResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: 'already_claimed' }
  | { ok: false; reason: 'database'; message: string };

// ---------------------------------------------------------------------------
// claimDailyReminder
// ---------------------------------------------------------------------------

/**
 * Claims an appointment's 24-hour reminder.
 *
 * @param store               - Database operations.
 * @param input.appointmentId - The appointment.
 * @param input.token         - Token for the email's YES/NO links.
 * @param input.staleClaimIds - Stale 'pending' claims found when the reminder was
 *                              found due (see classifyReminderClaims()).
 * @param input.now           - Current instant (stored as send_at).
 * @returns                   The claim row id, 'already_claimed', or a database error.
 */
export async function claimDailyReminder(
  store: ClaimStore,
  input: { appointmentId: string; token: string; staleClaimIds: readonly string[]; now: Date },
): Promise<ClaimResult> {
  // Step 1: Retire claims left by a run that crashed between claiming and
  // sending. Fewer rows changed than expected means another run retired
  // (and re-claimed) them first.
  if (input.staleClaimIds.length > 0) {
    try {
      const retired = await store.retirePendingClaims(input.staleClaimIds);
      if (retired < input.staleClaimIds.length) return { ok: false, reason: 'already_claimed' };
    } catch (err) {
      return { ok: false, reason: 'database', message: errorMessage(err) };
    }
  }

  // Step 2: Insert the claim. A unique violation means another run holds it.
  let inserted: InsertClaimResult;
  try {
    inserted = await store.insertClaim({
      appointmentId: input.appointmentId,
      token: input.token,
      sendAt: input.now.toISOString(),
    });
  } catch (err) {
    return { ok: false, reason: 'database', message: errorMessage(err) };
  }
  if (!inserted.ok) {
    return inserted.duplicate
      ? { ok: false, reason: 'already_claimed' }
      : { ok: false, reason: 'database', message: inserted.message };
  }
  const claimId = inserted.row.id;

  // Step 3: Read the live claims back; only the oldest one sends.
  try {
    const live = await store.loadLiveClaims(input.appointmentId);
    if (!wonClaimRace(claimId, live)) {
      await store.markSkipped(claimId);
      return { ok: false, reason: 'already_claimed' };
    }
  } catch (err) {
    // Unknown whether this claim won: give it up rather than risk a duplicate.
    await store.markSkipped(claimId).catch(() => undefined);
    return { ok: false, reason: 'database', message: errorMessage(err) };
  }

  return { ok: true, claimId };
}

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
