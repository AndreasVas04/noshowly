/**
 * components/dashboard/booking-settings/useStaffEditor.ts
 *
 * State and handlers of the "Staff" section of the booking settings page
 * (StaffSection, StaffCard, StaffAvailability, AddStaffForm): the staff list,
 * each staff member's profile (name, bio, photo URL) and weekly availability
 * with breaks as edited, adding (POST /api/barbers) and removing
 * (DELETE /api/barbers/[id]) staff members.
 *
 * Profile and availability changes are auto-saved per staff member 800 ms
 * after the last change (PUT /api/barbers/[id], then
 * POST /api/staff-availability), one save at a time per staff member. The
 * save is held back while a working day has impossible hours.
 */

'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import {
  buildBarberForm,
  getWorkingHoursError,
  makeDefaultDayState,
  sameBreaks,
  WEEK_DAYS,
  type BarberFormState,
  type DayState,
  type SaveStatus,
} from '@/components/dashboard/booking-settings/form-state';
import { normaliseBreaks, workingDayToTimeSlots } from '@/lib/schedule';
import type { Barber, StaffAvailability } from '@/types';

/**
 * Owns the staff list and each staff member's form, with auto-save.
 *
 * @returns The state and handlers used by the staff components, plus
 *          initStaff for the initial load and updateBarberField for
 *          useStaffPhotos.
 */
export function useStaffEditor() {
  // -------------------------------------------------------------------------
  // Section 2: Staff
  // -------------------------------------------------------------------------
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [staffAvailability, setStaffAvailability] = useState<StaffAvailability[]>([]);
  const [barberForms, setBarberForms] = useState<Record<string, BarberFormState>>({});
  const [addBarberName, setAddBarberName] = useState('');
  const [addingBarber, setAddingBarber] = useState(false);
  const [addBarberError, setAddBarberError] = useState('');
  const [barberSaveStatuses, setBarberSaveStatuses] = useState<Record<string, SaveStatus>>({});
  /** Per-barber message when auto-save is held back because working hours are invalid. */
  const [availabilityErrors, setAvailabilityErrors] = useState<Record<string, string>>({});
  const [deletingBarberId, setDeletingBarberId] = useState<string | null>(null);
  /** Refs to bio textarea elements, keyed by barberId — used for auto-resize on data load. */
  const bioTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  /** Per-barber debounce timers for profile + availability auto-save. */
  const barberDebounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /**
   * Ref that always holds the latest handleSaveBarber closure.
   * Same pattern as doSaveBookingPageRef (useBookingPageSettings) — prevents stale
   * closures in debounce timers.
   */
  const handleSaveBarberRef = useRef<(id: string) => Promise<void>>(async () => {});
  /** Per-barber: a save is in flight / another save is queued behind it. */
  const barberSaveInFlightRef = useRef<Record<string, boolean>>({});
  const barberSaveQueuedRef = useRef<Record<string, boolean>>({});

  /**
   * Auto-resizes all bio textareas whenever barberForms changes (e.g. initial
   * load, external update). Runs after paint so scrollHeight is accurate.
   */
  useEffect(() => {
    for (const el of Object.values(bioTextareaRefs.current)) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [barberForms]);

  /**
   * Stores a staff member's bio textarea for the auto-resize above, or clears
   * it with null. Used as the textarea's ref callback.
   *
   * @param barberId - UUID of the barber.
   * @param el       - The textarea, or null.
   */
  function registerBioTextarea(barberId: string, el: HTMLTextAreaElement | null): void {
    bioTextareaRefs.current[barberId] = el;
  }

  /**
   * Sets the staff members and availability loaded on mount and builds each
   * staff member's form from them.
   *
   * @param loadedBarbers      - The salon's staff members.
   * @param loadedAvailability - All staff_availability rows of the salon.
   */
  const initStaff = useCallback((loadedBarbers: Barber[], loadedAvailability: StaffAvailability[]): void => {
    setBarbers(loadedBarbers);
    setStaffAvailability(loadedAvailability);

    // Initialise per-barber form state from DB data.
    const forms: Record<string, BarberFormState> = {};
    for (const barber of loadedBarbers) {
      forms[barber.id] = buildBarberForm(barber, loadedAvailability);
    }
    setBarberForms(forms);
  }, []);

  // -------------------------------------------------------------------------
  // Auto-save helpers
  // -------------------------------------------------------------------------

  /**
   * Schedules an auto-save for a barber's profile and availability after 800 ms.
   * Clears any previously pending save for this barber before scheduling a new one.
   * Uses handleSaveBarberRef to avoid stale-closure issues.
   *
   * @param barberId - UUID of the barber whose data should be saved.
   */
  function scheduleBarberSave(barberId: string): void {
    if (barberDebounceRefs.current[barberId]) clearTimeout(barberDebounceRefs.current[barberId]);
    barberDebounceRefs.current[barberId] = setTimeout(() => {
      void runBarberSave(barberId);
    }, 800);
  }

  /**
   * Runs one save at a time per barber (see runBookingSave in
   * useBookingPageSettings). The queued save reads the latest form state
   * through handleSaveBarberRef.
   *
   * @param barberId - UUID of the barber to save.
   */
  async function runBarberSave(barberId: string): Promise<void> {
    if (barberSaveInFlightRef.current[barberId]) {
      barberSaveQueuedRef.current[barberId] = true;
      return;
    }
    barberSaveInFlightRef.current[barberId] = true;
    try {
      await handleSaveBarberRef.current(barberId);
    } finally {
      barberSaveInFlightRef.current[barberId] = false;
      if (barberSaveQueuedRef.current[barberId]) {
        barberSaveQueuedRef.current[barberId] = false;
        void runBarberSave(barberId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Staff handlers
  // -------------------------------------------------------------------------

  /**
   * Updates a field in a barber's form state.
   *
   * @param barberId - UUID of the barber.
   * @param field    - Which field to update.
   * @param value    - New value.
   */
  function updateBarberField(barberId: string, field: 'name' | 'photo_url' | 'bio', value: string): void {
    setBarberForms((prev) => ({
      ...prev,
      [barberId]: { ...prev[barberId], [field]: value },
    }));
    // photo_url changes are handled by the upload/remove functions directly — skip debounce.
    if (field !== 'photo_url') {
      scheduleBarberSave(barberId);
    }
  }

  /**
   * Updates a single day's is_available flag in a barber's form.
   * Preserves existing work times and break when toggling back on.
   *
   * @param barberId  - UUID of the barber.
   * @param dow       - Day of week (0=Sun … 6=Sat).
   * @param available - New availability flag.
   */
  function setDayAvailable(barberId: string, dow: number, available: boolean): void {
    setBarberForms((prev) => {
      const current = prev[barberId]?.availability[dow] ?? makeDefaultDayState(dow);
      return {
        ...prev,
        [barberId]: {
          ...prev[barberId],
          availability: {
            ...prev[barberId].availability,
            [dow]: {
              ...current,
              is_available: available,
            },
          },
        },
      };
    });
    scheduleBarberSave(barberId);
  }

  /**
   * Updates the working start or end time for a day.
   *
   * @param barberId - UUID of the barber.
   * @param dow      - Day of week.
   * @param field    - 'work_start' or 'work_end'.
   * @param value    - HH:MM value.
   */
  function setWorkTime(barberId: string, dow: number, field: 'work_start' | 'work_end', value: string): void {
    setBarberForms((prev) => {
      const day = prev[barberId]?.availability[dow];
      if (!day) return prev;
      return {
        ...prev,
        [barberId]: {
          ...prev[barberId],
          availability: {
            ...prev[barberId].availability,
            [dow]: { ...day, [field]: value },
          },
        },
      };
    });
    scheduleBarberSave(barberId);
  }

  /**
   * Updates the start or end time of a specific break for a day.
   *
   * @param barberId   - UUID of the barber.
   * @param dow        - Day of week.
   * @param breakIndex - Index into the breaks array to update.
   * @param field      - 'start' or 'end'.
   * @param value      - HH:MM value.
   */
  function setBreakTime(barberId: string, dow: number, breakIndex: number, field: 'start' | 'end', value: string): void {
    setBarberForms((prev) => {
      const day = prev[barberId]?.availability[dow];
      if (!day) return prev;
      const newBreaks = day.breaks.map((brk, i) =>
        i === breakIndex ? { ...brk, [field]: value } : brk
      );
      return {
        ...prev,
        [barberId]: {
          ...prev[barberId],
          availability: {
            ...prev[barberId].availability,
            [dow]: { ...day, breaks: newBreaks },
          },
        },
      };
    });
    scheduleBarberSave(barberId);
  }

  /**
   * Appends a new break (default 13:00–14:00) to a day's breaks array.
   * Multiple breaks are supported — always appends, never replaces.
   *
   * @param barberId - UUID of the barber.
   * @param dow      - Day of week.
   */
  function addBreak(barberId: string, dow: number): void {
    setBarberForms((prev) => {
      const day = prev[barberId]?.availability[dow];
      if (!day) return prev;
      return {
        ...prev,
        [barberId]: {
          ...prev[barberId],
          availability: {
            ...prev[barberId].availability,
            [dow]: { ...day, breaks: [...day.breaks, { start: '13:00', end: '14:00' }] },
          },
        },
      };
    });
    scheduleBarberSave(barberId);
  }

  /**
   * Removes the break at the given index from a day's breaks array.
   *
   * @param barberId   - UUID of the barber.
   * @param dow        - Day of week.
   * @param breakIndex - Index of the break to remove.
   */
  function removeBreak(barberId: string, dow: number, breakIndex: number): void {
    setBarberForms((prev) => {
      const day = prev[barberId]?.availability[dow];
      if (!day) return prev;
      const newBreaks = day.breaks.filter((_, i) => i !== breakIndex);
      return {
        ...prev,
        [barberId]: {
          ...prev[barberId],
          availability: {
            ...prev[barberId].availability,
            [dow]: { ...day, breaks: newBreaks },
          },
        },
      };
    });
    scheduleBarberSave(barberId);
  }

  /**
   * Copies the breaks of the source day to every other available day, fitted
   * to each day's own working hours: breaks are clamped to that day's hours
   * and breaks outside them are dropped.
   *
   * @param barberId  - UUID of the barber.
   * @param sourceDow - Day of week to copy breaks from.
   */
  function copyBreakToAllDays(barberId: string, sourceDow: number): void {
    const form = barberForms[barberId];
    const sourceDay = form?.availability[sourceDow];
    // Only proceed if the source day actually has at least one break.
    if (!form || !sourceDay || sourceDay.breaks.length === 0) return;

    const updatedDays: Record<number, DayState> = {};
    for (let dow = 0; dow <= 6; dow++) {
      const day = form.availability[dow];
      if (!day || !day.is_available || dow === sourceDow) continue;
      const breaks = normaliseBreaks(day.work_start, day.work_end, sourceDay.breaks);
      if (!sameBreaks(breaks, day.breaks)) updatedDays[dow] = { ...day, breaks };
    }
    if (Object.keys(updatedDays).length === 0) return;

    setBarberForms((prev) => ({
      ...prev,
      [barberId]: {
        ...prev[barberId],
        availability: { ...prev[barberId].availability, ...updatedDays },
      },
    }));
    scheduleBarberSave(barberId);
  }

  /**
   * Saves a staff member's profile + full weekly availability.
   * Calls PUT /api/barbers/[id] then POST /api/staff-availability.
   *
   * @param barberId - UUID of the barber to save.
   */
  async function handleSaveBarber(barberId: string): Promise<void> {
    const form = barberForms[barberId];
    if (!form) return;

    // Silently skip if the name was cleared — don't alert during auto-save.
    const trimmedName = form.name.trim();
    if (!trimmedName) return;

    // Hold back the save while a working day has impossible hours.
    const hoursProblem = WEEK_DAYS
      .map(({ label, value }) => {
        const problem = getWorkingHoursError(form.availability[value] ?? makeDefaultDayState(value));
        return problem ? `${label}: ${problem}` : null;
      })
      .find((problem) => problem !== null);
    setAvailabilityErrors((prev) => {
      const next = { ...prev };
      if (hoursProblem) next[barberId] = hoursProblem;
      else delete next[barberId];
      return next;
    });
    if (hoursProblem) return;

    setBarberSaveStatuses((prev) => ({ ...prev, [barberId]: 'saving' }));
    let savedOk = false;

    try {
      // 1. Save profile fields (name, bio, photo_url).
      const profileRes = await fetch(`/api/barbers/${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          bio: form.bio.trim() || null,
          photo_url: form.photo_url.trim() || null,
        }),
      });

      if (!profileRes.ok) {
        const data = (await profileRes.json()) as { error?: string };
        alert(data.error ?? 'Failed to save staff member. Please try again.');
        return;
      }

      const { barber } = (await profileRes.json()) as { barber: Barber };
      setBarbers((prev) =>
        prev.map((b) => (b.id === barberId ? barber : b)).sort((a, b) => a.name.localeCompare(b.name))
      );

      // 2. Save all 7 days of availability.
      // Convert the DayState breaks model → time_slots for the DB: the working
      // window minus every break, with breaks clamped to the working hours and
      // empty or inverted breaks dropped (lib/schedule.ts).
      const days = Object.entries(form.availability).map(([dowStr, day]) => ({
        day_of_week:  parseInt(dowStr, 10),
        is_available: day.is_available,
        time_slots:   day.is_available ? workingDayToTimeSlots(day) : [],
      }));

      const availRes = await fetch('/api/staff-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barber_id: barberId, days }),
      });

      if (!availRes.ok) {
        const data = (await availRes.json()) as { error?: string };
        alert(data.error ?? 'Failed to save availability. Please try again.');
        return;
      }

      const { availability } = (await availRes.json()) as { availability: StaffAvailability[] };
      // Merge the upserted records into local state.
      setStaffAvailability((prev) => [
        ...prev.filter((a) => a.barber_id !== barberId),
        ...availability,
      ]);
      savedOk = true;
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      if (savedOk) {
        setBarberSaveStatuses((prev) => ({ ...prev, [barberId]: 'saved' }));
        // Only clears "Saved": a newer save of this staff member keeps its state.
        setTimeout(() => {
          setBarberSaveStatuses((prev) =>
            prev[barberId] === 'saved' ? { ...prev, [barberId]: 'idle' } : prev
          );
        }, 2000);
      } else {
        setBarberSaveStatuses((prev) => ({ ...prev, [barberId]: 'idle' }));
      }
    }
  }

  /**
   * Adds a new staff member via POST /api/barbers.
   *
   * @param e - Form submit event.
   */
  async function handleAddBarber(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setAddBarberError('');

    const trimmedName = addBarberName.trim();
    if (!trimmedName) { setAddBarberError('Name is required.'); return; }
    if (trimmedName.length > 50) { setAddBarberError('Name must be 50 characters or fewer.'); return; }

    setAddingBarber(true);

    try {
      const res = await fetch('/api/barbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddBarberError(data.error ?? 'Failed to add staff member. Please try again.');
        return;
      }

      const { barber } = (await res.json()) as { barber: Barber };
      setBarbers((prev) => [...prev, barber].sort((a, b) => a.name.localeCompare(b.name)));
      setBarberForms((prev) => ({
        ...prev,
        [barber.id]: buildBarberForm(barber, staffAvailability),
      }));
      setAddBarberName('');
    } catch {
      setAddBarberError('Something went wrong. Please try again.');
    } finally {
      setAddingBarber(false);
    }
  }

  /**
   * Removes a staff member via DELETE /api/barbers/[id].
   *
   * @param barberId   - UUID of the barber.
   * @param barberName - Used in the confirmation prompt.
   */
  async function handleDeleteBarber(barberId: string, barberName: string): Promise<void> {
    if (!window.confirm(`Remove "${barberName}" from your team? All their services and availability will also be removed. This cannot be undone.`)) return;

    setDeletingBarberId(barberId);

    try {
      const res = await fetch(`/api/barbers/${barberId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove staff member. Please try again.');
        return;
      }
      setBarbers((prev) => prev.filter((b) => b.id !== barberId));
      setBarberForms((prev) => {
        const next = { ...prev };
        delete next[barberId];
        return next;
      });
      setStaffAvailability((prev) => prev.filter((a) => a.barber_id !== barberId));
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setDeletingBarberId(null);
    }
  }

  // Keep the latest save function in a ref for the debounce timers. This
  // prevents stale-closure bugs when boolean state (toggles) changes and the
  // timeout fires after a single-event onChange.
  useEffect(() => {
    handleSaveBarberRef.current = handleSaveBarber;
  });

  return {
    barbers,
    barberForms,
    addBarberName,
    setAddBarberName,
    addingBarber,
    addBarberError,
    setAddBarberError,
    barberSaveStatuses,
    availabilityErrors,
    deletingBarberId,
    registerBioTextarea,
    initStaff,
    updateBarberField,
    setDayAvailable,
    setWorkTime,
    setBreakTime,
    addBreak,
    removeBreak,
    copyBreakToAllDays,
    handleAddBarber,
    handleDeleteBarber,
  };
}

/** State and handlers returned by useStaffEditor. */
export type StaffEditor = ReturnType<typeof useStaffEditor>;
