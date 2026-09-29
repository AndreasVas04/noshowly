/**
 * components/dashboard/appointment-modal/useModalData.ts
 *
 * Data the appointment modal loads each time it opens: the staff list, the
 * salon's services, its business hours and the staff/service assignments.
 * Responses that arrive after the modal has closed again are ignored.
 *
 * Also looks up whether the signed-in account is the public demo account
 * (for the demo-only note next to "Send reminder").
 */

'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { isDemoAccount } from '@/lib/demo';
import { normaliseTime } from '@/lib/time';
import type { BarberService, Barber, Service } from '@/types';
import type { BusinessHours } from './form';

/**
 * Loads the staff list, services, business hours and staff/service
 * assignments whenever the modal opens, and the demo account flag once.
 *
 * @param isOpen - Whether the modal is visible.
 * @returns The loaded data and loading flags, plus reset() for a new opening.
 */
export default function useModalData(isOpen: boolean) {
  // ---------------------------------------------------------------------------
  // Staff + services + hours
  // ---------------------------------------------------------------------------

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(isOpen);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(isOpen);
  /** Barber/service assignments — used to filter the staff dropdown and show durations. */
  const [barberServices, setBarberServices] = useState<BarberService[]>([]);
  /** Salon opening hours as 'HH:MM', or null when not configured. */
  const [salonHours, setSalonHours] = useState<BusinessHours | null>(null);

  /** Whether the signed-in account is the public demo account. */
  const [isDemo, setIsDemo] = useState(false);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Load the staff list, services, business hours and staff/service
  // assignments each time the modal opens. Responses that arrive after it has
  // closed again are ignored.
  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;

    /** The salon's staff list, for the staff dropdown. */
    async function loadBarbers(): Promise<void> {
      try {
        const res = await fetch('/api/barbers', { cache: 'no-store' });
        if (res.ok) {
          const payload = (await res.json()) as { barbers: Barber[] };
          if (!ignore) setBarbers(payload.barbers);
        }
      } catch (err) {
        console.error('[AddAppointmentModal] Failed to load staff:', err);
      } finally {
        if (!ignore) setIsLoadingBarbers(false);
      }
    }

    /** The salon's services. The form falls back to free text when there are none. */
    async function loadServices(): Promise<void> {
      try {
        const res = await fetch('/api/services', { cache: 'no-store' });
        if (res.ok) {
          const payload = (await res.json()) as { services: Service[] };
          if (!ignore) setServices(payload.services);
        }
      } catch (err) {
        console.error('[AddAppointmentModal] Failed to load services:', err);
      } finally {
        if (!ignore) setIsLoadingServices(false);
      }
    }

    /**
     * The salon's business hours (normalised to 'HH:MM' by the API). Only set
     * when both times are configured and form a valid range.
     */
    async function loadSalonHours(): Promise<void> {
      try {
        const res = await fetch('/api/salon', { cache: 'no-store' });
        if (res.ok) {
          const payload = (await res.json()) as {
            salon: { opening_time: string | null; closing_time: string | null };
          };
          const opening = normaliseTime(payload.salon.opening_time);
          const closing = normaliseTime(payload.salon.closing_time);
          if (!ignore) setSalonHours(opening && closing && opening < closing ? { opening, closing } : null);
        }
      } catch (err) {
        console.error('[AddAppointmentModal] Failed to load salon hours:', err);
      }
    }

    /**
     * Staff/service assignments, used to filter the staff dropdown when a
     * service is selected and to show per-staff durations.
     */
    async function loadBarberServices(): Promise<void> {
      try {
        const res = await fetch('/api/barber-services', { cache: 'no-store' });
        if (res.ok) {
          const payload = (await res.json()) as { barberServices: BarberService[] };
          if (!ignore) setBarberServices(payload.barberServices);
        }
      } catch (err) {
        console.error('[AddAppointmentModal] Failed to load barber service assignments:', err);
      }
    }

    loadBarbers();
    loadServices();
    loadSalonHours();
    loadBarberServices();
    return () => { ignore = true; };
  }, [isOpen]);

  // Look up whether this is the public demo account (for the demo-only note).
  useEffect(() => {
    let cancelled = false;
    createBrowserSupabaseClient()
      .auth.getUser()
      .then(({ data }) => { if (!cancelled) setIsDemo(isDemoAccount(data.user?.email)); })
      .catch(() => { /* Non-critical: the note simply stays hidden. */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Clears the business hours and marks the staff list and services as
   * loading again. Called while rendering when the modal opens, before the
   * load effect above runs for the new opening.
   */
  function reset(): void {
    setSalonHours(null);
    setIsLoadingBarbers(true);
    setIsLoadingServices(true);
  }

  return {
    barbers,
    isLoadingBarbers,
    services,
    isLoadingServices,
    barberServices,
    salonHours,
    isDemo,
    reset,
  };
}
