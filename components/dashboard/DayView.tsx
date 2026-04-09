/**
 * components/dashboard/DayView.tsx
 *
 * Interactive day view that displays all appointments for a selected date.
 *
 * Features:
 *  - Optional title prop: when provided, renders an h1 heading with the title
 *    and the current navigated date as a subtitle below it.
 *  - Prev / Next day navigation buttons.
 *  - "Today" shortcut button — visible only when NOT already on today.
 *  - "Add appointment" button that opens the AddAppointmentModal pre-filled
 *    with the currently displayed date.
 *  - Clicking an existing appointment card opens the modal in edit mode.
 *  - Fetches appointments from GET /api/appointments?date=YYYY-MM-DD whenever
 *    the selected date changes, and re-fetches after any save.
 *  - Renders active appointments chronologically, then cancelled appointments
 *    at the bottom (dimmed with strikethrough).
 *  - Handles loading, empty, and error states.
 *  - Staff filter pills: shown when the salon has 2+ staff members. "All" is
 *    selected by default. Switching days resets the filter to "All".
 *    When 0 or 1 staff exist no filter UI is rendered.
 *
 * This is a Client Component because it owns date navigation state, modal
 * state, and performs client-side data fetching.
 *
 * Usage (today page — fixed heading, starts on today):
 *   <DayView title="Today" />
 *
 * Usage (day-level calendar — date as heading, freely navigable):
 *   <DayView />
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, addDays, subDays, isToday } from 'date-fns';
import AppointmentCard from '@/components/dashboard/AppointmentCard';
import AddAppointmentModal from '@/components/dashboard/AddAppointmentModal';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { AppointmentWithDetails, AppointmentStatus, Barber } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date object as the YYYY-MM-DD string expected by
 * GET /api/appointments?date=...
 *
 * @param date - The date to format.
 * @returns ISO date string, e.g. "2026-04-01".
 */
function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Props accepted by DayView. */
interface DayViewProps {
  /**
   * The date to display on first render.
   * Defaults to today if omitted.
   */
  initialDate?: Date;

  /**
   * Optional static heading for the page.
   *
   * When provided, DayView renders an <h1> with this text and the current
   * navigated date as a subtitle beneath it. Use this when the parent page
   * already has a conceptual name (e.g. "Today") that should not change as
   * the user navigates between days.
   *
   * When omitted, the nav bar shows the date as the primary heading.
   */
  title?: string;
}

/**
 * DayView renders a day navigation header, an "Add appointment" button, and
 * a list of appointments for the currently selected date.
 *
 * Active appointments are listed first. Cancelled appointments appear at the
 * bottom with opacity-40 and a strikethrough on the client name so the owner
 * can focus on who is actually coming in.
 *
 * @param props.initialDate - Starting date; defaults to today.
 * @param props.title       - Optional fixed page heading.
 * @returns The full day view UI with navigation, modal, and appointment list.
 */
export default function DayView({ initialDate, title }: DayViewProps) {
  // currentDate drives both the header label and the API query.
  const [currentDate, setCurrentDate] = useState<Date>(() => initialDate ?? new Date());

  // Appointment data state.
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Staff filter state
  // ---------------------------------------------------------------------------

  /** Staff members for the authenticated salon. Fetched once on mount. */
  const [barbers, setBarbers] = useState<Barber[]>([]);

  /**
   * Currently selected staff filter.
   * null           = "All" — show every appointment regardless of assigned staff.
   * 'unassigned'   = show only appointments where barber_id is null.
   * any other UUID = show only appointments assigned to that staff member.
   * Resets to null whenever the user navigates to a different day.
   */
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Modal state
  // ---------------------------------------------------------------------------

  /** Whether the Add/Edit modal is currently open. */
  const [modalOpen, setModalOpen] = useState(false);
  /**
   * The appointment being edited. null when opening the modal in create mode.
   * Set to an appointment when the user clicks an existing card.
   */
  const [editingAppointment, setEditingAppointment] = useState<AppointmentWithDetails | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetches appointments for the given date from GET /api/appointments.
   * Wrapped in useCallback so the effect dependency array stays stable.
   *
   * @param date - The calendar date to load appointments for.
   */
  const fetchAppointments = useCallback(async (date: Date): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const dateParam = toDateParam(date);
      const response = await fetch(`/api/appointments?date=${dateParam}`, {
        // Disable Next.js cache so navigation always fetches fresh data.
        cache: 'no-store',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? 'Failed to load appointments');
      }

      const payload = (await response.json()) as { appointments: AppointmentWithDetails[] };
      setAppointments(payload.appointments);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      console.error('[DayView] fetchAppointments error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-fetch whenever the selected date changes.
  useEffect(() => {
    fetchAppointments(currentDate);
  }, [currentDate, fetchAppointments]);

  /**
   * Fetches the salon's staff list once on mount.
   * The filter UI is only rendered when the salon has 2+ staff members, so
   * for most small single-barber setups this data is fetched but never shown.
   */
  const fetchBarbers = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/barbers', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load staff');
      const data = (await res.json()) as { barbers: Barber[] };
      setBarbers(data.barbers);
    } catch (err) {
      // Non-fatal — the filter just won't be shown if staff can't be loaded.
      console.error('[DayView] fetchBarbers error:', err);
    }
  }, []);

  // Fetch staff once on mount.
  useEffect(() => {
    fetchBarbers();
  }, [fetchBarbers]);

  // ---------------------------------------------------------------------------
  // Supabase Realtime — live status updates
  // ---------------------------------------------------------------------------

  /**
   * Subscribes to appointment UPDATE events on the `appointments` table.
   *
   * When the salon owner's dashboard is open and a client replies YES or NO
   * (via SMS or email), the appointment status changes in the database. This
   * subscription picks up the change and updates the local appointments state
   * immediately so the owner sees the confirmation without refreshing the page.
   *
   * Scope: RLS ensures this subscription only receives events for appointments
   * belonging to the authenticated user's salon — no explicit salon_id filter
   * is required.
   *
   * Only the `status` field is applied from the realtime payload. The joined
   * display fields (client_name, barber_name, etc.) are preserved from the
   * existing local state since the realtime event only carries the raw row.
   */
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel('appointments-status-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'appointments' },
        (payload) => {
          const updated = payload.new as { id: string; status: AppointmentStatus };

          // Update only the status field — preserve joined fields (client_name etc.)
          // that the realtime row does not carry.
          setAppointments((prev) =>
            prev.map((a) =>
              a.id === updated.id ? { ...a, status: updated.status } : a,
            ),
          );
        },
      )
      .subscribe();

    return () => {
      // Unsubscribe when the component unmounts to avoid memory leaks.
      supabase.removeChannel(channel);
    };
  }, []);

  // Reset the staff filter to "All" whenever the user navigates to a new day.
  useEffect(() => {
    setSelectedBarberId(null);
  }, [currentDate]);

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------

  /** Move to the previous calendar day. */
  function handlePrevDay(): void {
    setCurrentDate((d) => subDays(d, 1));
  }

  /** Move to the next calendar day. */
  function handleNextDay(): void {
    setCurrentDate((d) => addDays(d, 1));
  }

  /** Jump back to today's date. */
  function handleToday(): void {
    setCurrentDate(new Date());
  }

  // ---------------------------------------------------------------------------
  // Modal handlers
  // ---------------------------------------------------------------------------

  /**
   * Opens the modal in create mode for the currently displayed date.
   * Called when the owner clicks "Add appointment".
   */
  function handleOpenAddModal(): void {
    setEditingAppointment(null);
    setModalOpen(true);
  }

  /**
   * Opens the modal in edit mode for the clicked appointment.
   *
   * @param appointment - The appointment to edit.
   */
  function handleOpenEditModal(appointment: AppointmentWithDetails): void {
    setEditingAppointment(appointment);
    setModalOpen(true);
  }

  /** Closes the modal without refreshing. */
  function handleModalClose(): void {
    setModalOpen(false);
    setEditingAppointment(null);
  }

  /**
   * Called by the modal after a successful save.
   * Closes the modal and re-fetches appointments so the list is up to date.
   */
  function handleModalSaved(): void {
    setModalOpen(false);
    setEditingAppointment(null);
    fetchAppointments(currentDate);
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const isCurrentlyToday = isToday(currentDate);

  // Format the date label: "Tuesday, April 1" — clear and unambiguous.
  const headingDate = format(currentDate, 'EEEE, MMMM d');

  // Append year only when viewing a date outside the current calendar year.
  const currentYear = new Date().getFullYear();
  const headingYear = currentDate.getFullYear() !== currentYear
    ? `, ${currentDate.getFullYear()}`
    : '';
  const fullDateLabel = `${headingDate}${headingYear}`;

  /**
   * Whether the staff filter pills should be rendered.
   * Only shown when the salon has 2+ staff members — a single-barber salon
   * has nothing to filter by.
   */
  const showStaffFilter = barbers.length >= 2;

  /**
   * Whether to show the "Unassigned" pill in the staff filter.
   * Only appears when at least one appointment for the current day has no
   * assigned staff member (barber_id is null).
   */
  const hasUnassignedAppointments = appointments.some((a) => a.barber_id === null);

  /**
   * Appointments visible under the current staff filter.
   * null          → all appointments
   * 'unassigned'  → only appointments with no staff assigned (barber_id is null)
   * UUID string   → only appointments for that specific staff member
   */
  const filteredAppointments =
    selectedBarberId === null
      ? appointments
      : selectedBarberId === 'unassigned'
        ? appointments.filter((a) => a.barber_id === null)
        : appointments.filter((a) => a.barber_id === selectedBarberId);

  // Active appointments listed first; cancelled appointments at the bottom
  // so the owner focuses on who is actually coming in.
  const activeAppointments = filteredAppointments.filter((a) => a.status !== 'cancelled');
  const cancelledAppointments = filteredAppointments.filter((a) => a.status === 'cancelled');
  const sortedAppointments = [...activeAppointments, ...cancelledAppointments];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>

      {/* =====================================================================
          Optional page heading — rendered when the title prop is provided.
      ===================================================================== */}
      {title && (
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{fullDateLabel}</p>
        </div>
      )}

      {/* =====================================================================
          Navigation header + Add appointment button.
      ===================================================================== */}
      {title ? (
        /* Today-page nav: Add button (secondary style) + optional Today shortcut.
           The "Add appointment" button is secondary here because the page heading
           already draws attention — no need for a large purple CTA competing with
           the appointment list below it. */
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400
              transition-colors focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-gray-400
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add appointment
          </button>

          {/* Today shortcut — only appears if somehow off today */}
          {!isCurrentlyToday && (
            <button
              onClick={handleToday}
              className="
                text-sm font-medium text-indigo-600 hover:text-indigo-700
                px-3 py-1.5 rounded-lg hover:bg-indigo-50
                transition-colors focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-indigo-400
              "
            >
              Today
            </button>
          )}
        </div>
      ) : (
        /* Day-browser nav: arrows + date heading + Add button + Today shortcut. */
        <div className="flex items-center gap-2 mb-4">

          {/* Prev day */}
          <button
            onClick={handlePrevDay}
            aria-label="Previous day"
            className="
              p-2 rounded-lg border border-gray-200
              text-gray-500 hover:text-gray-900 hover:bg-gray-50
              transition-colors focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-gray-400
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Date heading */}
          <h2 className="flex-1 text-base font-semibold text-gray-900">
            {fullDateLabel}
            {isCurrentlyToday && (
              <span className="ml-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full align-middle">
                Today
              </span>
            )}
          </h2>

          {/* Today shortcut — hidden when already on today */}
          {!isCurrentlyToday && (
            <button
              onClick={handleToday}
              className="
                text-sm font-medium text-indigo-600 hover:text-indigo-700
                px-3 py-1.5 rounded-lg hover:bg-indigo-50
                transition-colors focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-indigo-400
              "
            >
              Today
            </button>
          )}

          {/* Add appointment */}
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="
              flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold
              bg-indigo-600 text-white hover:bg-indigo-700
              transition-colors focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-indigo-500
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add appointment</span>
            <span className="sm:hidden">Add</span>
          </button>

          {/* Next day */}
          <button
            onClick={handleNextDay}
            aria-label="Next day"
            className="
              p-2 rounded-lg border border-gray-200
              text-gray-500 hover:text-gray-900 hover:bg-gray-50
              transition-colors focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-gray-400
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

        </div>
      )}

      {/* =====================================================================
          STAFF FILTER PILLS — only rendered when salon has 2+ staff members.
          "All" is always the first pill and is selected by default.
          Resets to "All" automatically when the user navigates to a new day.
      ===================================================================== */}
      {showStaffFilter && (
        <div className="flex flex-wrap gap-2 mb-4">

          {/* "All" pill */}
          <button
            type="button"
            onClick={() => setSelectedBarberId(null)}
            className={`
              px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
              ${selectedBarberId === null
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            All
          </button>

          {/* One pill per staff member */}
          {barbers.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBarberId(b.id)}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                ${selectedBarberId === b.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              {b.name}
            </button>
          ))}

          {/* "Unassigned" pill — only shown when at least one appointment
              for today has no staff member assigned (barber_id is null). */}
          {hasUnassignedAppointments && (
            <button
              type="button"
              onClick={() => setSelectedBarberId('unassigned')}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                ${selectedBarberId === 'unassigned'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              Unassigned
            </button>
          )}
        </div>
      )}

      {/* =====================================================================
          Content area
      ===================================================================== */}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white rounded-xl border border-gray-200 px-4 py-3 animate-pulse"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-4 bg-gray-200 rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
                <div className="w-16 h-5 bg-gray-200 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => fetchAppointments(currentDate)}
            className="text-sm text-red-600 underline mt-1 hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state — no appointments at all for this day */}
      {!isLoading && !error && appointments.length === 0 && (
        <p className="text-sm text-gray-400 py-4">No appointments today</p>
      )}

      {/* Empty state — appointments exist but none match the active staff filter */}
      {!isLoading && !error && appointments.length > 0 && sortedAppointments.length === 0 && (
        <p className="text-sm text-gray-400 py-4">No appointments for this staff member today</p>
      )}

      {/* Appointment list — active first, cancelled dimmed at bottom */}
      {!isLoading && !error && sortedAppointments.length > 0 && (
        <div className="space-y-2">
          {sortedAppointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              onClick={() => handleOpenEditModal(appointment)}
            />
          ))}
        </div>
      )}

      {/* =====================================================================
          Add/Edit modal
      ===================================================================== */}
      <AddAppointmentModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
        initialDate={currentDate}
        appointment={editingAppointment ?? undefined}
      />

    </div>
  );
}
