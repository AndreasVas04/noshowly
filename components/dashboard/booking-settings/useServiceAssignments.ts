/**
 * components/dashboard/booking-settings/useServiceAssignments.ts
 *
 * State and handlers for the services each staff member performs
 * (barber_services), with optional per-staff price and duration overrides,
 * shown in each staff card (StaffServices).
 *
 * Ticking a service updates the list at once and saves the staff member's
 * whole assignment set with PUT /api/barber-services; an override is saved
 * when its field loses focus. Saves run one at a time per staff member, and a
 * finished save keeps anything the owner changed while it was in flight
 * (lib/barber-services.ts).
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import { mergeSavedAssignments, toAssignmentValues } from '@/lib/barber-services';
import type { BarberService } from '@/types';

/**
 * Owns the salon's staff service assignments and their saving.
 *
 * @returns The assignments, the staff members being saved and the handlers
 *          used by StaffServices, plus initAssignments for the initial load
 *          and updateBarberServiceAssignments for useServicesEditor.
 */
export function useServiceAssignments() {
  // -------------------------------------------------------------------------
  // Salon-level service assignments (barber_services table)
  // -------------------------------------------------------------------------
  /** All barber_services assignments for this salon. */
  const [barberServiceAssignments, setBarberServiceAssignments] = useState<BarberService[]>([]);
  /**
   * Always the latest assignments. Written together with the state (see
   * updateBarberServiceAssignments) so a save started in the same event
   * handler sends what the owner just changed.
   */
  const barberServiceAssignmentsRef = useRef<BarberService[]>([]);
  /** Staff members whose service assignments are being saved (shows "Saving…"). */
  const [savingAssignmentsFor, setSavingAssignmentsFor] = useState<Record<string, boolean>>({});
  /** Per-barber: an assignment save is in flight / another save is queued behind it. */
  const assignmentSaveInFlightRef = useRef<Record<string, boolean>>({});
  const assignmentSaveQueuedRef = useRef<Record<string, boolean>>({});

  /**
   * Sets the assignments loaded on mount, in state and in
   * barberServiceAssignmentsRef together.
   *
   * @param assignments - All barber_services rows of the salon.
   */
  const initAssignments = useCallback((assignments: BarberService[]): void => {
    barberServiceAssignmentsRef.current = assignments;
    setBarberServiceAssignments(assignments);
  }, []);

  // -------------------------------------------------------------------------
  // Barber service assignment handler
  // -------------------------------------------------------------------------

  /**
   * Updates the assignment list in state and in barberServiceAssignmentsRef together.
   *
   * @param update - Returns the new list from the current one.
   */
  function updateBarberServiceAssignments(update: (prev: BarberService[]) => BarberService[]): void {
    const next = update(barberServiceAssignmentsRef.current);
    barberServiceAssignmentsRef.current = next;
    setBarberServiceAssignments(next);
  }

  /**
   * Toggles a service assignment for a barber: updates the list at once, then
   * queues a save of the barber's whole assignment set. Price/duration
   * overrides of the other assignments are kept.
   *
   * @param barberId  - The barber to update.
   * @param serviceId - The salon-level service to toggle.
   * @param checked   - True to add the assignment, false to remove it.
   */
  function handleToggleBarberService(barberId: string, serviceId: string, checked: boolean): void {
    updateBarberServiceAssignments((prev) => {
      const others = prev.filter((ba) => !(ba.barber_id === barberId && ba.service_id === serviceId));
      if (!checked) return others;
      return [
        ...others,
        {
          id:                       `tmp-${barberId}-${serviceId}`,
          salon_id:                 '',
          barber_id:                barberId,
          service_id:               serviceId,
          price_override:           null,
          duration_minutes_override: null,
          created_at:               '',
        },
      ];
    });
    void runAssignmentSave(barberId);
  }

  /**
   * Updates price or duration override for a barber-service assignment in local state.
   * The input's onBlur queues the save (runAssignmentSave).
   *
   * @param barberId  - UUID of the barber.
   * @param serviceId - UUID of the service.
   * @param field     - 'price_override' or 'duration_minutes_override'.
   * @param rawValue  - Raw string from the number input (empty = null).
   */
  function updateBarberServiceOverride(
    barberId: string,
    serviceId: string,
    field: 'price_override' | 'duration_minutes_override',
    rawValue: string,
  ): void {
    const parsed = rawValue === '' ? null : parseFloat(rawValue);
    // Reject NaN; round to integer for duration, leave decimal for price.
    const value: number | null =
      parsed === null || isNaN(parsed)
        ? null
        : field === 'duration_minutes_override'
          ? Math.round(parsed)
          : parsed;

    updateBarberServiceAssignments((prev) =>
      prev.map((ba) =>
        ba.barber_id === barberId && ba.service_id === serviceId
          ? { ...ba, [field]: value }
          : ba
      )
    );
  }

  /**
   * Runs one assignment save at a time per barber (see runBookingSave in
   * useBookingPageSettings). A change made while a save is in flight queues
   * one more save, which sends the latest list, so an older request can never
   * finish after (and overwrite) a newer one.
   *
   * @param barberId - UUID of the barber whose assignments should be saved.
   */
  async function runAssignmentSave(barberId: string): Promise<void> {
    if (assignmentSaveInFlightRef.current[barberId]) {
      assignmentSaveQueuedRef.current[barberId] = true;
      return;
    }
    assignmentSaveInFlightRef.current[barberId] = true;
    setSavingAssignmentsFor((prev) => ({ ...prev, [barberId]: true }));
    try {
      await saveBarberServiceAssignments(barberId);
    } finally {
      assignmentSaveInFlightRef.current[barberId] = false;
      if (assignmentSaveQueuedRef.current[barberId]) {
        assignmentSaveQueuedRef.current[barberId] = false;
        void runAssignmentSave(barberId);
      } else {
        setSavingAssignmentsFor((prev) => {
          const next = { ...prev };
          delete next[barberId];
          return next;
        });
      }
    }
  }

  /**
   * Saves a barber's whole assignment set, with price/duration overrides, via
   * PUT /api/barber-services. Called through runAssignmentSave only.
   *
   * The saved rows are merged in so that anything the owner changed while the
   * request was in flight is kept (lib/barber-services.ts). When the save is
   * rejected, the stored rows are reloaded and merged the same way, which undoes
   * the rejected change.
   *
   * @param barberId - UUID of the barber whose assignments should be saved.
   */
  async function saveBarberServiceAssignments(barberId: string): Promise<void> {
    const sent = toAssignmentValues(
      barberServiceAssignmentsRef.current.filter((ba) => ba.barber_id === barberId)
    );

    /** Merges the barber's rows as the server holds them into the current list. */
    function applySaved(saved: BarberService[]): void {
      updateBarberServiceAssignments((prev) => [
        ...prev.filter((ba) => ba.barber_id !== barberId),
        ...mergeSavedAssignments(prev.filter((ba) => ba.barber_id === barberId), sent, saved),
      ]);
    }

    try {
      const res = await fetch('/api/barber-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barber_id: barberId, assignments: sent }),
      });

      if (res.ok) {
        const data = (await res.json()) as { barberServices: BarberService[] };
        // An empty list for a non-empty save means the rows were saved but could
        // not be read back; keep what the owner sees.
        if (data.barberServices.length > 0 || sent.length === 0) {
          applySaved(data.barberServices);
        }
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error ?? 'Failed to save the services. Please check the price and duration.');

      const reloadRes = await fetch('/api/barber-services');
      if (reloadRes.ok) {
        const { barberServices } = (await reloadRes.json()) as { barberServices: BarberService[] };
        applySaved(barberServices.filter((ba) => ba.barber_id === barberId));
      }
    } catch (err) {
      console.error('[BookingPage] saveBarberServiceAssignments error:', err);
    }
  }

  return {
    barberServiceAssignments,
    savingAssignmentsFor,
    initAssignments,
    updateBarberServiceAssignments,
    handleToggleBarberService,
    updateBarberServiceOverride,
    runAssignmentSave,
  };
}

/** State and handlers returned by useServiceAssignments. */
export type ServiceAssignments = ReturnType<typeof useServiceAssignments>;
