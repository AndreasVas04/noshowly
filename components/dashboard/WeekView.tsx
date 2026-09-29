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
 *    Keyboard users reach the same through each column's "Add" button, which
 *    is visually hidden until it has focus.
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
 * Weeks and days are calendar days in the salon's timezone (fetched from
 * /api/salon): "today", week boundaries and the column an appointment lands
 * in all follow the salon's clock, wherever the owner's browser is. Nothing
 * date-dependent is rendered until the timezone is known, which also keeps
 * the server render free of dates.
 *
 * This is a Client Component because it owns all navigation and modal state.
 */

'use client';

import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import AddAppointmentModal from '@/components/dashboard/AddAppointmentModal';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { isPastAppointment, STATUS_LABELS, weekCardClasses } from '@/lib/appointment-status';
import {
  addDaysToDate,
  browserTimeZone,
  formatDateOnly,
  formatTimeInZone,
  resolveTimeZone,
  startOfWeekDate,
  todayInZone,
  utcToZonedParts,
} from '@/lib/time';
import type { AppointmentWithDetails, Barber, Salon } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the seven salon dates (Mon–Sun) of the week containing a date.
 *
 * @param anchor - Any 'YYYY-MM-DD' date in the week.
 */
function getWeekDays(anchor: string): string[] {
  const monday = startOfWeekDate(anchor, 1);
  return Array.from({ length: 7 }, (_, i) => addDaysToDate(monday, i));
}

/**
 * Filters appointments by the currently selected staff context, then returns
 * only those on the given salon calendar day.
 *
 * Day comparison uses the salon's timezone, so the column a card lands in
 * matches the time shown on it and the week the salon sees.
 *
 * @param appointments    - Full list of appointments for the week.
 * @param selectedBarber  - Filtering context:
 *                          null         → show all (default, or 0-staff case)
 *                          'unassigned' → show only appointments with no barber
 *                          UUID string  → show only that staff member's appointments
 * @param day             - Salon calendar day ('YYYY-MM-DD') to filter by.
 * @param timezone        - Salon timezone.
 * @returns Appointments matching both the staff filter and the given day, sorted
 *          chronologically (API returns them in order already, so this preserves it).
 */
function getAppointmentsForDayAndStaff(
  appointments: AppointmentWithDetails[],
  selectedBarber: string | null,
  day: string,
  timezone: string,
): AppointmentWithDetails[] {
  return appointments.filter((apt) => {
    // Day filter — the appointment's date in the salon's timezone.
    if (utcToZonedParts(apt.datetime, timezone).date !== day) return false;

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
  timezone: string;
}

/**
 * Compact appointment card for the week grid.
 * Color-coded by status (lib/appointment-status.ts), with a cue that does not
 * rely on colour: confirmed is green with a check mark, pending amber,
 * cancelled red with a dashed border and the name struck through. Past
 * appointments are greyed out with a "Past" label. The status is also part of
 * the button's accessible name.
 *
 * @param props.apt     - The appointment data.
 * @param props.onClick - Opens the edit modal for this appointment.
 */
function WeekCard({ apt, onClick, timezone }: WeekCardProps) {
  const isCancelled = apt.status === 'cancelled';
  const isPast      = isPastAppointment(apt);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // prevent column click from also firing
        onClick();
      }}
      className={[
        'block w-full text-left rounded-lg border px-2 py-1.5 space-y-0.5',
        'hover:brightness-95 transition-all cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A]/30',
        isCancelled ? 'border-dashed' : '',
        weekCardClasses(apt.status, isPast),
      ].join(' ')}
    >
      {/* Time + a check mark when confirmed, or a "Past" label for past unanswered */}
      <span className="text-xs font-bold text-[#1A1A1A] tabular-nums leading-none flex items-center gap-1">
        {formatTimeInZone(apt.datetime, timezone)}
        {!isPast && apt.status === 'confirmed' && (
          <Check className="w-3 h-3 text-[#1B4332] shrink-0" strokeWidth={3} aria-hidden="true" />
        )}
        {isPast && (
          <span className="text-[9px] font-medium text-[#6F6B65] bg-[#E5E2DB]/60 px-1 py-0.5 rounded leading-none">
            Past
          </span>
        )}
      </span>

      {/* Client name */}
      <span className={`block text-xs font-semibold text-[#1A1A1A] truncate leading-snug ${isCancelled ? 'line-through' : ''}`}>
        {apt.client_name ?? 'Unknown'}
      </span>

      {/* Service — only if set */}
      {apt.service_type && (
        <span className="block text-xs text-[#2D2D2D]/75 truncate leading-snug">
          {apt.service_type}
        </span>
      )}

      {/* Status for screen readers ("Past" is already visible) */}
      {!isPast && <span className="sr-only">{STATUS_LABELS[apt.status]}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DayColumn — one column in the 7-day desktop grid
// ---------------------------------------------------------------------------

/** Props for a single day column in the desktop week grid. */
interface DayColumnProps {
  /** The salon calendar day ('YYYY-MM-DD') this column represents. */
  day: string;
  /** Whether this column is today in the salon's timezone. */
  isToday: boolean;
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
  timezone: string;
}

/**
 * DayColumn renders a single day column in the desktop week grid.
 * The column header shows the day name and date (today is highlighted).
 * Clicking the empty body area adds an appointment on that day; keyboard and
 * screen reader users get an "Add" button below the body instead, visually
 * hidden until it has focus.
 *
 * @param props.day                - The calendar day this column represents.
 * @param props.appointments       - Appointments to display (already filtered).
 * @param props.onAppointmentClick - Called when a card is clicked.
 * @param props.onColumnClick      - Called when the empty column area is clicked.
 */
function DayColumn({ day, isToday: todayColumn, appointments, onAppointmentClick, onColumnClick, timezone }: DayColumnProps) {
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
          ${todayColumn ? 'text-[#1B4332] font-bold' : 'text-[#6F6B65] font-semibold'}`}>
          {formatDateOnly(day, { weekday: 'short' })}
        </p>
        <p className={`text-sm mt-0.5 leading-none font-body
          ${todayColumn ? 'text-[#1B4332] font-bold' : 'text-[#2D2D2D] font-bold'}`}>
          {Number(day.slice(8, 10))}
        </p>
      </div>

      {/* Clickable body — clicking empty area opens add modal for this day */}
      <div
        onClick={onColumnClick}
        className="flex-1 p-1.5 space-y-1.5 min-h-[220px] bg-[#FAFAF8] cursor-pointer"
      >
        {appointments.length === 0 && (
          <p className="text-xs text-[#6F6B65]/50 p-1 select-none">—</p>
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

      {/* The same action for keyboard and screen reader users, shown when focused */}
      <button
        type="button"
        onClick={onColumnClick}
        aria-label={`Add appointment on ${formatDateOnly(day, { weekday: 'long', month: 'long', day: 'numeric' })}`}
        className="
          sr-only focus-visible:not-sr-only
          border-t border-[#E5E2DB] bg-white text-xs text-[#1B4332] font-body
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B4332]/30
        "
      >
        <span className="block py-1.5">+ Add</span>
      </button>
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
  // Week navigation state (salon dates, 'YYYY-MM-DD')
  // -------------------------------------------------------------------------

  /** Salon timezone for dates and times; null until loaded. */
  const [salonTimezone, setSalonTimezone] = useState<string | null>(null);

  /**
   * Anchor date determines which Mon–Sun week strip is displayed.
   * Any date within the desired week works. Null until the timezone is known.
   */
  const [anchor, setAnchor] = useState<string | null>(null);

  /**
   * selectedDay is only used on mobile to determine which single day to display.
   * On desktop all 7 columns are shown simultaneously.
   */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Staff state
  // -------------------------------------------------------------------------

  /** Staff members for the authenticated salon. */
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(true);

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
  const [error, setError] = useState<string | null>(null);
  /** Incremented to refetch the week: after a save, on "Try again" and on realtime changes. */
  const [refreshCount, setRefreshCount] = useState(0);
  /** The request whose response `appointments` and `error` hold. */
  const [loadedRequest, setLoadedRequest] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Modal state
  // -------------------------------------------------------------------------

  const [modalOpen, setModalOpen] = useState(false);
  /** Salon date to pre-fill when opening the add modal. */
  const [modalInitialDate, setModalInitialDate] = useState<string | undefined>(undefined);
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

  const today    = salonTimezone ? todayInZone(salonTimezone) : null;
  const weekDays = anchor ? getWeekDays(anchor) : [];
  const weekStart = weekDays[0] ?? null;
  const weekEnd   = weekDays[6] ?? null;
  const isCurrentWeek = !today || weekStart === startOfWeekDate(today, 1);

  /** Identifies the appointments request for the visible week; null until the week is known. */
  const appointmentsRequest = weekStart ? `${weekStart}#${refreshCount}` : null;
  const isLoadingApts = appointmentsRequest === null || loadedRequest !== appointmentsRequest;

  /** Human-readable week label, e.g. "Mar 30 – Apr 5". */
  const weekLabel = (() => {
    if (!weekStart || !weekEnd) return '';
    const startStr = formatDateOnly(weekStart, { month: 'short', day: 'numeric' });
    const endStr   = formatDateOnly(weekEnd, { month: 'short', day: 'numeric' });
    const endYear  = today && weekEnd.slice(0, 4) !== today.slice(0, 4) ? `, ${weekEnd.slice(0, 4)}` : '';
    return `${startStr} – ${endStr}${endYear}`;
  })();

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  // Fetch the salon's staff list and timezone once on mount, then open the
  // current week in the salon's timezone. The staff filter is left at null
  // ("All"): never silently hide appointments by pre-selecting a staff member
  // the user has not chosen.
  useEffect(() => {
    let ignore = false;

    async function loadSalon(): Promise<void> {
      let staff: Barber[] = [];
      let timeZone: string | null = null;
      try {
        const [barbersRes, salonRes] = await Promise.all([
          fetch('/api/barbers', { cache: 'no-store' }),
          fetch('/api/salon',   { cache: 'no-store' }),
        ]);
        if (barbersRes.ok) {
          const data = (await barbersRes.json()) as { barbers: Barber[] };
          staff = data.barbers;
        }
        if (salonRes.ok) {
          const data = (await salonRes.json()) as { salon: Salon };
          timeZone = resolveTimeZone(data.salon.timezone);
        }
      } catch (err) {
        console.error('[WeekView] Failed to load staff and salon timezone:', err);
        staff = [];
      }
      if (ignore) return;

      const zone = timeZone ?? browserTimeZone();
      const todayDate = todayInZone(zone);
      setBarbers(staff);
      setSalonTimezone(zone);
      setAnchor((a) => a ?? todayDate);
      setSelectedDay((d) => d ?? todayDate);
      setIsLoadingBarbers(false);
    }

    loadSalon();
    return () => { ignore = true; };
  }, []);

  // Fetch all appointments of the visible Mon–Sun week in one request (the
  // dates are salon dates; the API applies the salon's timezone), again
  // whenever a refresh is requested. A response for a week the owner has
  // already moved away from is ignored. Staff filtering is done client-side
  // so switching staff pills is instant.
  useEffect(() => {
    if (!appointmentsRequest || !weekStart || !weekEnd) return;
    let ignore = false;

    async function loadWeek(start: string, end: string, request: string): Promise<void> {
      try {
        const res = await fetch(`/api/appointments?start=${start}&end=${end}`, { cache: 'no-store' });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error((payload as { error?: string }).error ?? 'Failed to load appointments');
        }
        const data = (await res.json()) as { appointments: AppointmentWithDetails[] };
        if (ignore) return;
        setAppointments(data.appointments);
        setError(null);
      } catch (err) {
        console.error('[WeekView] Failed to load appointments:', err);
        if (!ignore) setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        if (!ignore) setLoadedRequest(request);
      }
    }

    loadWeek(weekStart, weekEnd, appointmentsRequest);
    return () => { ignore = true; };
  }, [appointmentsRequest, weekStart, weekEnd]);

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
          setRefreshCount((count) => count + 1);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    setAnchor((a) => (a ? addDaysToDate(a, -7) : a));
    setSelectedDay((d) => (d ? addDaysToDate(d, -7) : d));
  }

  /** Move to the next week; keep selectedDay on the same weekday. */
  function handleNextWeek(): void {
    setAnchor((a) => (a ? addDaysToDate(a, 7) : a));
    setSelectedDay((d) => (d ? addDaysToDate(d, 7) : d));
  }

  /** Reset to today's week and select today. Hidden when already on current week. */
  function handleThisWeek(): void {
    if (!today) return;
    setAnchor(today);
    setSelectedDay(today);
  }

  /** Select a day (mobile only — switches the single-day view). */
  function handleDaySelect(day: string): void {
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
   * @param day - The salon date of the column the user clicked.
   */
  function handleColumnClick(day: string): void {
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
    setModalInitialDate(selectedDay ?? undefined);
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
    setRefreshCount((count) => count + 1);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isLoading = isLoadingBarbers || isLoadingApts || !salonTimezone || !selectedDay;

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
              text-[#6F6B65] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
              transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Week date range — the page's heading */}
          <h1 className="text-base font-semibold text-[#1A1A1A] whitespace-nowrap font-body">
            <span className="sr-only">Week of </span>
            {weekLabel}
          </h1>

          {/* Next week */}
          <button
            onClick={handleNextWeek}
            aria-label="Next week"
            className="
              p-2 rounded-lg border border-[#E5E2DB] shrink-0
              text-[#6F6B65] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
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
            aria-pressed={selectedBarberId === null}
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
              aria-pressed={selectedBarberId === b.id}
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
              aria-pressed={selectedBarberId === 'unassigned'}
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
          const isSelected   = day === selectedDay;
          const isCurrentDay = day === today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => handleDaySelect(day)}
              aria-label={formatDateOnly(day, { weekday: 'long', month: 'long', day: 'numeric' })}
              aria-pressed={isSelected}
              className={`
                flex flex-col items-center justify-center
                flex-1 min-w-0 px-1 py-2 rounded-xl text-center transition-colors font-body
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/30
                ${isSelected
                  ? 'bg-[#1B4332] text-white shadow-sm'
                  : isCurrentDay
                    ? 'border border-[#1B4332]/30 text-[#1B4332] hover:bg-[#E8F2EC]/50'
                    : 'text-[#6F6B65] hover:bg-[#E5E2DB]/50'
                }
              `}
            >
              <span className="text-xs font-semibold uppercase tracking-wide leading-none">
                {formatDateOnly(day, { weekday: 'short' })}
              </span>
              <span className="text-sm font-bold mt-0.5 leading-none">
                {Number(day.slice(8, 10))}
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
            onClick={() => setRefreshCount((count) => count + 1)}
            className="text-sm text-red-600 underline mt-1 hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* =====================================================================
          DESKTOP: 7-column week grid (lg+)
      ===================================================================== */}
      {!isLoading && !error && salonTimezone && (
        <div className="hidden lg:flex gap-2 overflow-x-auto pb-1">
          {weekDays.map((day) => {
            const dayApts = getAppointmentsForDayAndStaff(appointments, selectedBarberId, day, salonTimezone);

            return (
              <DayColumn
                key={day}
                day={day}
                isToday={day === today}
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
      {!isLoading && !error && salonTimezone && selectedDay && (
        <div className="lg:hidden space-y-2">
          {(() => {
            const dayApts = getAppointmentsForDayAndStaff(appointments, selectedBarberId, selectedDay, salonTimezone);

            if (dayApts.length === 0) {
              return (
                <p className="text-sm text-[#6F6B65] py-4 font-body">No appointments this day</p>
              );
            }

            return dayApts.map((apt) => {
              const past = isPastAppointment(apt);
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
                    {formatTimeInZone(apt.datetime, salonTimezone)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold text-[#1A1A1A] truncate font-body ${apt.status === 'cancelled' ? 'line-through' : ''}`}>
                      {apt.client_name ?? 'Unknown client'}
                    </p>
                    {apt.service_type && (
                      <p className="text-xs text-[#6F6B65] mt-0.5 truncate font-body">{apt.service_type}</p>
                    )}
                  </div>
                  {past && (
                    <span className="text-xs font-medium text-[#6F6B65] bg-[#F0EFED] px-2 py-0.5 rounded-full font-body shrink-0">
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
              text-sm text-[#6F6B65] hover:border-[#1B4332]/30 hover:text-[#1B4332] hover:bg-[#E8F2EC]/30
              transition-colors font-body
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            {/* Weekday and day formatted separately: en-US puts the day first ("5 Mon"). */}
            + Add for {formatDateOnly(selectedDay, { weekday: 'short' })} {formatDateOnly(selectedDay, { day: 'numeric' })}
          </button>
        </div>
      )}

      {/* =====================================================================
          ADD / EDIT MODAL
      ===================================================================== */}
      {salonTimezone && (
        <AddAppointmentModal
          isOpen={modalOpen}
          onClose={handleModalClose}
          onSaved={handleModalSaved}
          timezone={salonTimezone}
          initialDate={modalInitialDate}
          initialBarberId={modalInitialBarberId}
          appointment={editingAppointment ?? undefined}
        />
      )}

    </div>
  );
}
