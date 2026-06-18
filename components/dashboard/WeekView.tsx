/**
 * components/dashboard/WeekView.tsx
 *
 * Week view showing all staff schedules across all 7 days.
 *
 * Layout:
 *  - Top bar: prev/next week arrows flanking the week date range ("Mar 30 – Apr 5"),
 *    plus an "Add appointment" button on the right.
 *  - Below the week range: staff selector pills.
 *    - 0 staff: no pills — all appointments shown in a single week grid.
 *    - 1+ staff: "All" pill (default) + one pill per staff + "Unassigned" pill
 *      when unassigned appointments exist.
 *  - Desktop (lg+): 7-column grid, one column per day (Mon–Sun), showing
 *    the selected staff filter's appointments in each column.
 *  - Mobile (< lg): day selector strip (Mon–Sun pills) + single day view for
 *    the selected filter on the selected day.
 *
 * Interactions:
 *  - Prev/next week arrows navigate the week.
 *  - "Today" button resets to the current week — only shown when off the current week.
 *  - Staff pills switch which appointments are displayed. Default: "All".
 *  - Clicking a day column's empty area opens the add modal with that day
 *    and staff pre-filled (when a named staff member is currently selected).
 *  - Clicking an appointment card opens the edit modal.
 *  - "Add appointment" button opens the add modal.
 *
 * Data fetching:
 *  - Barbers: fetched once on mount from GET /api/barbers.
 *  - Appointments: fetched for the whole week via
 *    GET /api/appointments?start=YYYY-MM-DD&end=YYYY-MM-DD whenever the week changes.
 *    Staff filtering is done client-side so switching staff pills is instant.
 *
 * Visual states for appointment cards:
 *  - confirmed: green background
 *  - scheduled (future): amber background
 *  - scheduled (past, time has elapsed): grey/muted + "Past" label
 *  - cancelled: dashed border, red tint, reduced opacity
 *
 * This is a Client Component because it owns all navigation and modal state.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  format,
  addWeeks,
  subWeeks,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isToday,
  isSameDay,
  isSameWeek,
} from 'date-fns';
import AddAppointmentModal from '@/components/dashboard/AddAppointmentModal';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { AppointmentWithDetails, Barber, Salon } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date as a YYYY-MM-DD string used as an API query parameter and
 * as a map key when grouping appointments by day.
 *
 * @param date - The date to format.
 * @returns ISO date string, e.g. "2026-04-01".
 */
function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Formats an ISO datetime string as a 24-hour time string.
 * Uses the salon's IANA timezone when provided so appointments display correctly
 * regardless of the browser's local timezone. Falls back to browser timezone
 * when no timezone is specified (backwards compatible).
 *
 * @param isoString - ISO 8601 datetime stored in the database (UTC).
 * @param timezone  - Optional IANA timezone, e.g. "Europe/Nicosia".
 * @returns 24-hour time string like "09:30".
 */
function formatTime(isoString: string, timezone?: string): string {
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(isoString));
    const h = parts.find((p) => p.type === 'hour')?.value   ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h === '24' ? '00' : h}:${m}`;
  }
  const d = new Date(isoString);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Returns true when a scheduled appointment's time has already passed.
 * Only meaningful for 'scheduled' status — confirmed and cancelled are
 * not affected by whether their time has passed.
 *
 * @param apt - The appointment to check.
 * @returns true if the appointment is not cancelled and its datetime has passed.
 */
function isPastScheduled(apt: AppointmentWithDetails): boolean {
  return apt.status !== 'cancelled' && new Date(apt.datetime) < new Date();
}

/**
 * Filters appointments by the currently selected staff context, then returns
 * only those on the given calendar day.
 *
 * Day comparison is done in local browser timezone so the column a card lands
 * in matches the time the owner sees — consistent with how date navigation works.
 *
 * @param appointments    - Full list of appointments for the week.
 * @param selectedBarber  - Filtering context:
 *                          null         → show all (default, or 0-staff case)
 *                          'unassigned' → show only appointments with no barber
 *                          UUID string  → show only that staff member's appointments
 * @param day             - Calendar day to filter by.
 * @returns Appointments matching both the staff filter and the given day, sorted
 *          chronologically (API returns them in order already, so this preserves it).
 */
function getAppointmentsForDayAndStaff(
  appointments: AppointmentWithDetails[],
  selectedBarber: string | null,
  day: Date
): AppointmentWithDetails[] {
  const dayKey = toDateParam(day);

  return appointments.filter((apt) => {
    // Day filter — compare the appointment's local date to the target day key.
    // Both use browser local timezone, so they are consistent with each other.
    if (toDateParam(new Date(apt.datetime)) !== dayKey) return false;

    // Staff filter
    if (selectedBarber === null)           return true;  // "All": show everything
    if (selectedBarber === 'unassigned')   return apt.barber_id === null;
    return apt.barber_id === selectedBarber;
  });
}

// ---------------------------------------------------------------------------
// AppointmentCard — inline since it's only used in WeekView columns
// ---------------------------------------------------------------------------

/** Props for a single appointment card inside a week column. */
interface WeekCardProps {
  /** The appointment to render. */
  apt: AppointmentWithDetails;
  /** Called when the card is clicked to open the edit modal. */
  onClick: () => void;
  /** IANA timezone for displaying appointment times. */
  timezone?: string;
}

/**
 * Returns Tailwind border and background classes for a pill colored by status.
 *  confirmed          = forest green
 *  scheduled (future) = amber
 *  scheduled (past)   = grey/muted — time elapsed without a YES/NO reply
 *  cancelled          = red/dim, dashed border handled by the parent element
 *
 * @param status - Appointment lifecycle status.
 * @param isPast - Whether this is a past unanswered appointment.
 * @returns       Tailwind class string.
 */
function pillClasses(status: AppointmentWithDetails['status'], isPast: boolean): string {
  if (isPast) {
    // Past appointment (any non-cancelled status) — grey/muted
    return 'border-[#C8C8C8]/60 bg-[#F0EFED] opacity-60';
  }
  switch (status) {
    case 'confirmed':
      return 'border-[#1B4332]/30 bg-[#E8F2EC]';
    case 'cancelled':
      return 'border-red-200/60 bg-red-50/50 opacity-50';
    default: // 'scheduled' (upcoming) — shown as pending
      return 'border-amber-200 bg-amber-50';
  }
}

/**
 * Compact appointment card for the week grid.
 * Color-coded by status. Past unanswered appointments are greyed out with a
 * "Past" label so they are visually distinct from active upcoming appointments.
 *
 * @param props.apt     - The appointment data.
 * @param props.onClick - Opens the edit modal for this appointment.
 */
function WeekCard({ apt, onClick, timezone }: WeekCardProps) {
  const isCancelled = apt.status === 'cancelled';
  const isPast      = isPastScheduled(apt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation(); // prevent column click from also firing
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onClick();
        }
      }}
      className={[
        'rounded-lg border px-2 py-1.5 space-y-0.5',
        'hover:brightness-95 transition-all cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A]/30',
        isCancelled ? 'border-dashed' : '',
        pillClasses(apt.status, isPast),
      ].join(' ')}
    >
      {/* Time + optional "Past" label for past unanswered */}
      <p className="text-xs font-bold text-[#1A1A1A] tabular-nums leading-none flex items-center gap-1">
        {formatTime(apt.datetime, timezone)}
        {isPast && (
          <span className="text-[9px] font-medium text-[#8A8680] bg-[#E5E2DB]/60 px-1 py-0.5 rounded leading-none">
            Past
          </span>
        )}
      </p>

      {/* Client name */}
      <p className={`text-xs font-semibold text-[#1A1A1A] truncate leading-snug ${isCancelled ? 'line-through' : ''}`}>
        {apt.client_name ?? 'Unknown'}
      </p>

      {/* Service — only if set */}
      {apt.service_type && (
        <p className="text-xs text-[#2D2D2D]/60 truncate leading-snug">
          {apt.service_type}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayColumn — one column in the 7-day desktop grid
// ---------------------------------------------------------------------------

/** Props for a single day column in the desktop week grid. */
interface DayColumnProps {
  /** The calendar day this column represents. */
  day: Date;
  /** Appointments to show in this column (already filtered by staff). */
  appointments: AppointmentWithDetails[];
  /** Called when the user clicks an appointment card. */
  onAppointmentClick: (apt: AppointmentWithDetails) => void;
  /**
   * Called when the user clicks the empty body of the column.
   * Used to open the add modal pre-filled with this day.
   */
  onColumnClick: () => void;
  /** IANA timezone for displaying appointment times. */
  timezone?: string;
}

/**
 * DayColumn renders a single day column in the desktop week grid.
 * The column header shows the day name and date (today is highlighted).
 * The empty body area is clickable to add a new appointment for that day.
 *
 * @param props.day                - The calendar day this column represents.
 * @param props.appointments       - Appointments to display (already filtered).
 * @param props.onAppointmentClick - Called when a card is clicked.
 * @param props.onColumnClick      - Called when the empty column area is clicked.
 */
function DayColumn({ day, appointments, onAppointmentClick, onColumnClick, timezone }: DayColumnProps) {
  const todayColumn = isToday(day);

  return (
    <div
      className={`
        flex flex-col flex-1 min-w-[115px] rounded-xl overflow-hidden border
        ${todayColumn ? 'border-[#1B4332]/40' : 'border-[#E5E2DB]'}
      `}
    >
      {/* Column header */}
      <div
        className={`
          px-2 py-2.5 text-center border-b shrink-0
          ${todayColumn ? 'bg-[#E8F2EC] border-[#1B4332]/20' : 'bg-white border-[#E5E2DB]'}
        `}
      >
        <p className={`text-xs uppercase tracking-wide leading-none font-body
          ${todayColumn ? 'text-[#1B4332] font-bold' : 'text-[#8A8680] font-semibold'}`}>
          {format(day, 'EEE')}
        </p>
        <p className={`text-sm mt-0.5 leading-none font-body
          ${todayColumn ? 'text-[#1B4332] font-bold' : 'text-[#2D2D2D] font-bold'}`}>
          {format(day, 'd')}
        </p>
      </div>

      {/* Clickable body — clicking empty area opens add modal for this day */}
      <div
        role="button"
        tabIndex={-1}
        aria-label={`Add appointment on ${format(day, 'EEEE, MMMM d')}`}
        onClick={onColumnClick}
        className="flex-1 p-1.5 space-y-1.5 min-h-[220px] bg-[#FAFAF8] cursor-pointer"
      >
        {appointments.length === 0 && (
          <p className="text-xs text-[#8A8680]/50 p-1 select-none">—</p>
        )}

        {appointments.map((apt) => (
          <WeekCard
            key={apt.id}
            apt={apt}
            onClick={() => onAppointmentClick(apt)}
            timezone={timezone}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * WeekView renders the week-based schedule with a staff selector and a
 * 7-day column grid (desktop) or single-day mobile view.
 *
 * @returns The full week view with navigation, staff pills, day grid, and modal.
 */
export default function WeekView() {

  // -------------------------------------------------------------------------
  // Week navigation state
  // -------------------------------------------------------------------------

  /**
   * Anchor date determines which Mon–Sun week strip is displayed.
   * Any date within the desired week works; startOfWeek is derived from it.
   */
  const [anchor, setAnchor] = useState<Date>(() => new Date());

  /**
   * selectedDay is only used on mobile to determine which single day to display.
   * On desktop all 7 columns are shown simultaneously.
   */
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  // -------------------------------------------------------------------------
  // Staff state
  // -------------------------------------------------------------------------

  /** Staff members for the authenticated salon. */
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(true);

  /** Salon timezone for correct time display (fetched once on mount). */
  const [salonTimezone, setSalonTimezone] = useState<string | undefined>(undefined);

  /**
   * Which staff filter is active.
   *  null         — show ALL appointments (default for all cases).
   *  'unassigned' — show only appointments with no barber assigned.
   *  UUID string  — show only that staff member's appointments.
   *
   * Default is always null ("All") so no appointments are silently hidden on load.
   */
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Appointments state
  // -------------------------------------------------------------------------

  /** All appointments for the visible week (unfiltered — filtering is client-side). */
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [isLoadingApts, setIsLoadingApts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Modal state
  // -------------------------------------------------------------------------

  const [modalOpen, setModalOpen] = useState(false);
  /** Date to pre-fill when opening the add modal. */
  const [modalInitialDate, setModalInitialDate] = useState<Date>(() => new Date());
  /**
   * Staff UUID to pre-select when the modal opens from a day column click.
   * Undefined when opened via the "Add appointment" header button or when
   * "All" / "Unassigned" is the active filter.
   */
  const [modalInitialBarberId, setModalInitialBarberId] = useState<string | undefined>(undefined);
  /** When set, the modal opens in edit mode pre-filled with this appointment. */
  const [editingAppointment, setEditingAppointment] = useState<AppointmentWithDetails | null>(null);

  // -------------------------------------------------------------------------
  // Derived date values (recomputed each render — cheap)
  // -------------------------------------------------------------------------

  const weekStart  = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd    = endOfWeek(anchor, { weekStartsOn: 1 });
  const weekDays   = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const isCurrentWeek = isSameWeek(anchor, new Date(), { weekStartsOn: 1 });

  /** Human-readable week label, e.g. "Mar 30 – Apr 5". */
  const weekLabel = (() => {
    const startStr = format(weekStart, 'MMM d');
    const endYear  = weekEnd.getFullYear() !== new Date().getFullYear()
      ? `, ${weekEnd.getFullYear()}`
      : '';
    return `${startStr} – ${format(weekEnd, 'MMM d')}${endYear}`;
  })();

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  /**
   * Fetches the salon's staff list and timezone. Called once on mount.
   * Does NOT set a default staff — selection always starts at null ("All") so
   * no appointments are hidden when the page loads.
   */
  const fetchBarbers = useCallback(async (): Promise<void> => {
    setIsLoadingBarbers(true);
    try {
      const [barbersRes, salonRes] = await Promise.all([
        fetch('/api/barbers', { cache: 'no-store' }),
        fetch('/api/salon',   { cache: 'no-store' }),
      ]);
      if (barbersRes.ok) {
        const data = (await barbersRes.json()) as { barbers: Barber[] };
        setBarbers(data.barbers);
      } else {
        setBarbers([]);
      }
      if (salonRes.ok) {
        const data = (await salonRes.json()) as { salon: Salon };
        setSalonTimezone(data.salon.timezone ?? undefined);
      }
      // Always default to null ("All") — never silently hide appointments by
      // pre-selecting a specific staff member that the user has not chosen.
      setSelectedBarberId(null);
    } catch (err) {
      console.error('[WeekView] fetchBarbers error:', err);
      setBarbers([]);
      setSelectedBarberId(null);
    } finally {
      setIsLoadingBarbers(false);
    }
  }, []);

  /**
   * Fetches all appointments for the given Mon–Sun range in a single request.
   * Staff filtering is done client-side so switching staff pills is instant.
   *
   * @param start - Monday of the target week.
   * @param end   - Sunday of the target week.
   */
  const fetchWeekAppointments = useCallback(async (start: Date, end: Date): Promise<void> => {
    setIsLoadingApts(true);
    setError(null);
    try {
      const url = `/api/appointments?start=${toDateParam(start)}&end=${toDateParam(end)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? 'Failed to load appointments');
      }
      const data = (await res.json()) as { appointments: AppointmentWithDetails[] };
      setAppointments(data.appointments);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      console.error('[WeekView] fetchWeekAppointments error:', err);
    } finally {
      setIsLoadingApts(false);
    }
  }, []);

  // Fetch barbers and appointments in parallel on mount.
  useEffect(() => {
    fetchBarbers();
    fetchWeekAppointments(weekStart, weekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch appointments whenever the user navigates to a different week.
  useEffect(() => {
    fetchWeekAppointments(weekStart, weekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  /**
   * Subscribes to appointment changes via Supabase Realtime.
   * Refetches the week on any INSERT, UPDATE, or DELETE so the grid stays current.
   */
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel('week-appointments-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        () => {
          fetchWeekAppointments(weekStart, weekEnd);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, fetchWeekAppointments]);

  // -------------------------------------------------------------------------
  // Derived visibility flags
  // -------------------------------------------------------------------------

  /**
   * Whether any appointments for the current week have no staff assigned.
   * Drives the "Unassigned" pill visibility.
   */
  const hasUnassigned = appointments.some((a) => a.barber_id === null);

  /**
   * Show the "Unassigned" tab whenever unassigned appointments exist for the
   * current week AND the salon has at least 1 named staff member.
   * With 0 staff every appointment is unassigned by definition — a separate
   * tab adds no value. With 1+ staff this ensures migrated or no-staff
   * appointments are always reachable.
   */
  const showUnassignedTab = hasUnassigned && barbers.length >= 1;

  /**
   * Show staff pills whenever there is at least 1 named staff member.
   * With 0 staff: no pills — "All" is implied and there is nothing to filter by.
   * With 1+ staff: "All" pill + per-staff pills + optional "Unassigned" pill.
   */
  const showStaffPills = barbers.length >= 1;

  // -------------------------------------------------------------------------
  // Navigation handlers
  // -------------------------------------------------------------------------

  /** Move to the previous week; keep selectedDay on the same weekday. */
  function handlePrevWeek(): void {
    setAnchor((a) => subWeeks(a, 1));
    setSelectedDay((d) => subWeeks(d, 1));
  }

  /** Move to the next week; keep selectedDay on the same weekday. */
  function handleNextWeek(): void {
    setAnchor((a) => addWeeks(a, 1));
    setSelectedDay((d) => addWeeks(d, 1));
  }

  /** Reset to today's week and select today. Hidden when already on current week. */
  function handleThisWeek(): void {
    const today = new Date();
    setAnchor(today);
    setSelectedDay(today);
  }

  /** Select a day (mobile only — switches the single-day view). */
  function handleDaySelect(day: Date): void {
    setSelectedDay(day);
    setAnchor(day);
  }

  // -------------------------------------------------------------------------
  // Modal handlers
  // -------------------------------------------------------------------------

  /**
   * Opens the add modal from a day column click.
   * Pre-fills the date and — when a named staff member is currently selected — the staff.
   * When "All" (null) or "Unassigned" is active, no staff is pre-selected.
   *
   * @param day - The day column the user clicked.
   */
  function handleColumnClick(day: Date): void {
    setEditingAppointment(null);
    setModalInitialDate(day);
    // Pre-select staff only when a real staff member (not null/"unassigned") is viewed.
    const preselect =
      selectedBarberId && selectedBarberId !== 'unassigned'
        ? selectedBarberId
        : undefined;
    setModalInitialBarberId(preselect);
    setModalOpen(true);
  }

  /**
   * Opens the add modal from the "Add appointment" header button.
   * Uses the currently selected day (mobile) or today/anchor (desktop).
   */
  function handleHeaderAddClick(): void {
    setEditingAppointment(null);
    setModalInitialDate(selectedDay);
    setModalInitialBarberId(undefined);
    setModalOpen(true);
  }

  /**
   * Opens the edit modal for a clicked appointment card.
   *
   * @param apt - The appointment to edit.
   */
  function handleAppointmentClick(apt: AppointmentWithDetails): void {
    setEditingAppointment(apt);
    setModalOpen(true);
  }

  /** Closes the modal without refreshing. */
  function handleModalClose(): void {
    setModalOpen(false);
    setEditingAppointment(null);
  }

  /**
   * Called after a successful save. Closes the modal and re-fetches the
   * week so columns reflect the change immediately.
   */
  function handleModalSaved(): void {
    setModalOpen(false);
    setEditingAppointment(null);
    fetchWeekAppointments(weekStart, weekEnd);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isLoading = isLoadingBarbers || isLoadingApts;

  /** Shared pill class helper for staff filter buttons. */
  function staffPillClass(active: boolean): string {
    return [
      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors font-body',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/30',
      active
        ? 'bg-[#1B4332] text-white'
        : 'border border-[#E5E2DB] text-[#4A4540] hover:bg-[#E8F2EC]/50',
    ].join(' ');
  }

  return (
    <div className="flex flex-col">

      {/* =====================================================================
          TOP BAR — week navigation + Add appointment button
      ===================================================================== */}
      <div className="flex items-center justify-between mb-4 gap-4">

        {/* Left: arrows + week label + "Today" reset */}
        <div className="flex items-center gap-2 min-w-0">

          {/* Previous week */}
          <button
            onClick={handlePrevWeek}
            aria-label="Previous week"
            className="
              p-2 rounded-lg border border-[#E5E2DB] shrink-0
              text-[#8A8680] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
              transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Week date range */}
          <span className="text-base font-semibold text-[#1A1A1A] whitespace-nowrap font-body">
            {weekLabel}
          </span>

          {/* Next week */}
          <button
            onClick={handleNextWeek}
            aria-label="Next week"
            className="
              p-2 rounded-lg border border-[#E5E2DB] shrink-0
              text-[#8A8680] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
              transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* "Today" shortcut — only visible when off the current week */}
          {!isCurrentWeek && (
            <button
              onClick={handleThisWeek}
              className="
                text-sm font-medium text-[#4A4540] shrink-0 font-body
                px-2.5 py-1.5 rounded-lg border border-[#E5E2DB] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
                transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
              "
            >
              Today
            </button>
          )}
        </div>

        {/* Right: Add appointment */}
        <button
          type="button"
          onClick={handleHeaderAddClick}
          className="
            flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shrink-0
            bg-[#1B4332] text-white hover:bg-[#16392A]
            transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/40
          "
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Add appointment</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* =====================================================================
          STAFF PILLS — "All" + per-staff + optional "Unassigned"
          Shown when salon has 1+ staff members. Default selection: "All".
      ===================================================================== */}
      {!isLoadingBarbers && showStaffPills && (
        <div className="flex flex-wrap gap-2 mb-4">

          {/* "All" pill — always first, shows every appointment */}
          <button
            type="button"
            onClick={() => setSelectedBarberId(null)}
            className={staffPillClass(selectedBarberId === null)}
          >
            All
          </button>

          {/* One pill per named staff member */}
          {barbers.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBarberId(b.id)}
              className={staffPillClass(selectedBarberId === b.id)}
            >
              {b.name}
            </button>
          ))}

          {/* "Unassigned" pill — only when unassigned appointments exist */}
          {showUnassignedTab && (
            <button
              type="button"
              onClick={() => setSelectedBarberId('unassigned')}
              className={staffPillClass(selectedBarberId === 'unassigned')}
            >
              Unassigned
            </button>
          )}
        </div>
      )}

      {/* =====================================================================
          MOBILE DAY SELECTOR — Mon–Sun pills (hidden on desktop)
      ===================================================================== */}
      <div className="flex lg:hidden items-center gap-1 mb-4">
        {weekDays.map((day) => {
          const isSelected   = isSameDay(day, selectedDay);
          const isCurrentDay = isToday(day);
          return (
            <button
              key={toDateParam(day)}
              type="button"
              onClick={() => handleDaySelect(day)}
              aria-label={format(day, 'EEEE, MMMM d')}
              aria-pressed={isSelected}
              className={`
                flex flex-col items-center justify-center
                flex-1 min-w-[42px] px-1 py-2 rounded-xl text-center transition-colors font-body
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/30
                ${isSelected
                  ? 'bg-[#1B4332] text-white shadow-sm'
                  : isCurrentDay
                    ? 'border border-[#1B4332]/30 text-[#1B4332] hover:bg-[#E8F2EC]/50'
                    : 'text-[#8A8680] hover:bg-[#E5E2DB]/50'
                }
              `}
            >
              <span className="text-xs font-semibold uppercase tracking-wide leading-none">
                {format(day, 'EEE')}
              </span>
              <span className="text-sm font-bold mt-0.5 leading-none">
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          LOADING SKELETON
      ===================================================================== */}
      {isLoading && (
        <div className="hidden lg:flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 min-w-[115px] rounded-xl border border-[#E5E2DB] overflow-hidden animate-pulse"
            >
              <div className="px-2 py-2.5 bg-white border-b border-[#E5E2DB] text-center">
                <div className="h-3 bg-[#E5E2DB] rounded mx-auto w-8 mb-1" />
                <div className="h-4 bg-[#E5E2DB] rounded mx-auto w-6" />
              </div>
              <div className="p-1.5 space-y-1.5 min-h-[220px] bg-[#FAFAF8]">
                <div className="h-14 bg-[#E5E2DB]/60 rounded-lg" />
                <div className="h-10 bg-[#E5E2DB]/60 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mobile loading */}
      {isLoading && (
        <div className="lg:hidden space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white rounded-xl border border-[#E5E2DB] px-4 py-3 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-4 bg-[#E5E2DB] rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[#E5E2DB] rounded w-1/3" />
                  <div className="h-3 bg-[#E5E2DB]/70 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* =====================================================================
          ERROR STATE
      ===================================================================== */}
      {!isLoading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => fetchWeekAppointments(weekStart, weekEnd)}
            className="text-sm text-red-600 underline mt-1 hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* =====================================================================
          DESKTOP: 7-column week grid (lg+)
      ===================================================================== */}
      {!isLoading && !error && (
        <div className="hidden lg:flex gap-2 overflow-x-auto pb-1">
          {weekDays.map((day) => {
            const dayApts = getAppointmentsForDayAndStaff(appointments, selectedBarberId, day);

            return (
              <DayColumn
                key={toDateParam(day)}
                day={day}
                appointments={dayApts}
                onAppointmentClick={handleAppointmentClick}
                onColumnClick={() => handleColumnClick(day)}
                timezone={salonTimezone}
              />
            );
          })}
        </div>
      )}

      {/* =====================================================================
          MOBILE: single selected-day view (< lg)
      ===================================================================== */}
      {!isLoading && !error && (
        <div className="lg:hidden space-y-2">
          {(() => {
            const dayApts = getAppointmentsForDayAndStaff(appointments, selectedBarberId, selectedDay);

            if (dayApts.length === 0) {
              return (
                <p className="text-sm text-[#8A8680] py-4 font-body">No appointments this day</p>
              );
            }

            return dayApts.map((apt) => {
              const past = isPastScheduled(apt);
              return (
                <button
                  key={apt.id}
                  type="button"
                  onClick={() => handleAppointmentClick(apt)}
                  className={[
                    'w-full text-left',
                    'bg-white rounded-xl border border-[#E5E2DB]',
                    'px-4 py-3',
                    'flex items-center justify-between gap-4',
                    'hover:border-[#1B4332]/20 hover:shadow-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20',
                    apt.status === 'cancelled' ? 'opacity-40' : '',
                    past ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <div className="w-12 shrink-0 text-sm font-bold text-[#1A1A1A] tabular-nums font-body">
                    {formatTime(apt.datetime, salonTimezone)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold text-[#1A1A1A] truncate font-body ${apt.status === 'cancelled' ? 'line-through' : ''}`}>
                      {apt.client_name ?? 'Unknown client'}
                    </p>
                    {apt.service_type && (
                      <p className="text-xs text-[#8A8680] mt-0.5 truncate font-body">{apt.service_type}</p>
                    )}
                  </div>
                  {past && (
                    <span className="text-xs font-medium text-[#8A8680] bg-[#F0EFED] px-2 py-0.5 rounded-full font-body shrink-0">
                      Past
                    </span>
                  )}
                </button>
              );
            });
          })()}

          {/* Mobile add button for the selected day */}
          <button
            type="button"
            onClick={() => handleColumnClick(selectedDay)}
            className="
              w-full mt-2 py-2.5 rounded-xl border border-dashed border-[#E5E2DB]
              text-sm text-[#8A8680] hover:border-[#1B4332]/30 hover:text-[#1B4332] hover:bg-[#E8F2EC]/30
              transition-colors font-body
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            + Add for {format(selectedDay, 'EEE d')}
          </button>
        </div>
      )}

      {/* =====================================================================
          ADD / EDIT MODAL
      ===================================================================== */}
      <AddAppointmentModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
        initialDate={modalInitialDate}
        initialBarberId={modalInitialBarberId}
        appointment={editingAppointment ?? undefined}
      />

    </div>
  );
}
