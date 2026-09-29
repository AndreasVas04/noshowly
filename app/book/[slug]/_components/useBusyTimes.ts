/**
 * app/book/[slug]/_components/useBusyTimes.ts
 *
 * Busy times of the date picked on the public booking page, from
 * GET /api/book/[slug]?date=. BookingFlow removes them from the offered
 * start times.
 *
 * Each load is a new request: picking a date, "Try again", and a time that
 * was taken while the visitor was booking it (409). The times count as
 * loading until the current request has answered, and a slow response to an
 * outdated request never overwrites a newer one.
 */

'use client';

import { useState, useEffect } from 'react';
import type { PublicBusyInterval } from '@/types';

/**
 * Loads the busy times of the selected date.
 *
 * @param slug         - Booking page slug.
 * @param selectedDate - 'YYYY-MM-DD' in the salon timezone, or null before a date is picked.
 * @returns The busy times and error message of the current request, whether it
 *          is still loading, and `reloadBusy`, which starts a new request.
 */
export function useBusyTimes(slug: string, selectedDate: string | null) {
  const [busy,         setBusy]         = useState<PublicBusyInterval[]>([]);
  const [slotsError,   setSlotsError]   = useState('');
  /** Incremented to (re)load the selected date's busy times. */
  const [busyRequestCount, setBusyRequestCount] = useState(0);
  /** The request whose response `busy` and `slotsError` hold. */
  const [loadedBusyRequest, setLoadedBusyRequest] = useState<string | null>(null);

  /** Identifies the busy-times request for the selected date; null when no date is selected. */
  const busyRequest = selectedDate ? `${selectedDate}#${busyRequestCount}` : null;
  const loadingSlots = busyRequest !== null && loadedBusyRequest !== busyRequest;

  // Fetch the selected date's busy times from GET /api/book/[slug]?date=,
  // for every new request. A slow response to an outdated request never
  // overwrites a newer one.
  useEffect(() => {
    if (!busyRequest || !selectedDate) return;
    let ignore = false;

    async function loadBusy(date: string, request: string): Promise<void> {
      try {
        const res = await fetch(`/api/book/${encodeURIComponent(slug)}?date=${date}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as { busy?: PublicBusyInterval[] };
        if (ignore) return;
        setBusy(data.busy ?? []);
        setSlotsError('');
      } catch (err) {
        console.error('[BookingFlow] Failed to load booked times:', err);
        if (!ignore) {
          setBusy([]);
          setSlotsError('Could not load the available times. Please try again.');
        }
      } finally {
        if (!ignore) setLoadedBusyRequest(request);
      }
    }

    loadBusy(selectedDate, busyRequest);
    return () => { ignore = true; };
  }, [busyRequest, selectedDate, slug]);

  /** Starts a new request for the selected date's busy times. */
  function reloadBusy(): void {
    setBusyRequestCount((count) => count + 1);
  }

  return { busy, slotsError, loadingSlots, reloadBusy };
}
