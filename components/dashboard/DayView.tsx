/**
 * components/dashboard/DayView.tsx
 *
 * Interactive day view that displays all appointments for a selected date.
 *
 * Features:
 *  - Optional title prop: renders an h1 heading with the title and date subtitle.
 *  - Prev / Next day navigation buttons.
 *  - "Today" shortcut button — visible only when NOT already on today.
 *  - "Add appointment" button that opens the AddAppointmentModal.
 *  - Clicking an existing appointment card opens the modal in edit mode.
 *  - Fetches appointments from GET /api/appointments?date=YYYY-MM-DD.
 *  - Active appointments first; cancelled dimmed at bottom.
 *  - Staff filter pills when salon has 2+ staff members.
 *  - Supabase Realtime subscription for live status updates.
 *
 * Days are calendar days in the salon's timezone (fetched from /api/salon),
 * so "today" and the appointments listed match the salon's clock wherever
 * the owner's browser is. Nothing date-dependent is rendered until the
 * timezone is known, which also keeps the server render free of dates.
 *
 * Premium design: brand-dark buttons, clean typography, generous whitespace.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AppointmentCard from '@/components/dashboard/AppointmentCard';
import AddAppointmentModal from '@/components/dashboard/AddAppointmentModal';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { isPastAppointment } from '@/lib/appointment-status';
import { addDaysToDate, browserTimeZone, formatDateOnly, resolveTimeZone, todayInZone } from '@/lib/time';
import type { AppointmentWithDetails, Barber, Salon } from '@/types';

/** Props accepted by DayView. */
interface DayViewProps {
  /** Starting salon date ('YYYY-MM-DD'); defaults to today in the salon's timezone. */
  initialDate?: string;
  /**
   * Optional static heading (e.g. "Today"). When provided, DayView renders
   * an h1 with this text and the navigated date as subtitle.
   */
  title?: string;
}

/**
 * DayView renders navigation, an appointment list, and the Add/Edit modal
 * for a selected calendar day.
 *
 * @param props.initialDate - Starting salon date; defaults to today in the salon's timezone.
 * @param props.title       - Optional fixed page heading.
 */
export default function DayView({ initialDate, title }: DayViewProps) {
  /** Salon date being shown ('YYYY-MM-DD'); null until the salon timezone is known. */
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);

  /** Salon timezone for dates and times (fetched once on mount). */
  const [salonTimezone, setSalonTimezone] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentWithDetails | null>(null);

  /**
   * Fetches appointments for the given salon date.
   *
   * @param date - The salon calendar date ('YYYY-MM-DD') to load appointments for.
   */
  const fetchAppointments = useCallback(async (date: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/appointments?date=${date}`, { cache: 'no-store' });

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

  useEffect(() => {
    if (currentDate) fetchAppointments(currentDate);
  }, [currentDate, fetchAppointments]);

  /**
   * Fetches the salon's staff list and timezone once on mount, then opens
   * the starting date (today in the salon's timezone by default).
   */
  const fetchSalonData = useCallback(async (): Promise<void> => {
    let timeZone: string | null = null;
    try {
      const [barbersRes, salonRes] = await Promise.all([
        fetch('/api/barbers', { cache: 'no-store' }),
        fetch('/api/salon',   { cache: 'no-store' }),
      ]);
      if (barbersRes.ok) {
        const data = (await barbersRes.json()) as { barbers: Barber[] };
        setBarbers(data.barbers);
      }
      if (salonRes.ok) {
        const data = (await salonRes.json()) as { salon: Salon };
        timeZone = resolveTimeZone(data.salon.timezone);
      }
    } catch (err) {
      console.error('[DayView] fetchSalonData error:', err);
    }

    const zone = timeZone ?? browserTimeZone();
    setSalonTimezone(zone);
    setCurrentDate((date) => date ?? initialDate ?? todayInZone(zone));
  }, [initialDate]);

  useEffect(() => {
    fetchSalonData();
  }, [fetchSalonData]);

  /**
   * Subscribes to appointment changes via Supabase Realtime.
   * Listens for INSERT, UPDATE, and DELETE events so the list stays current
   * when appointments are created, modified, or removed from another tab/device.
   * RLS scopes events to the authenticated salon's appointments.
   */
  useEffect(() => {
    if (!currentDate) return;
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel('appointments-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        () => {
          // Refetch the full list on any change — simple and correct.
          fetchAppointments(currentDate);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentDate, fetchAppointments]);

  // Reset staff filter when navigating to a new day.
  useEffect(() => {
    setSelectedBarberId(null);
  }, [currentDate]);

  function handlePrevDay(): void { setCurrentDate((d) => (d ? addDaysToDate(d, -1) : d)); }
  function handleNextDay(): void { setCurrentDate((d) => (d ? addDaysToDate(d, 1) : d)); }
  function handleToday(): void { if (salonTimezone) setCurrentDate(todayInZone(salonTimezone)); }

  function handleOpenAddModal(): void {
    setEditingAppointment(null);
    setModalOpen(true);
  }

  function handleOpenEditModal(appointment: AppointmentWithDetails): void {
    setEditingAppointment(appointment);
    setModalOpen(true);
  }

  function handleModalClose(): void {
    setModalOpen(false);
    setEditingAppointment(null);
  }

  function handleModalSaved(): void {
    setModalOpen(false);
    setEditingAppointment(null);
    if (currentDate) fetchAppointments(currentDate);
  }

  // Date labels — only computed once the salon timezone is known (client-side).
  const todayDate = salonTimezone ? todayInZone(salonTimezone) : null;
  const isCurrentlyToday = currentDate !== null && currentDate === todayDate;
  const fullDateLabel = (() => {
    if (!currentDate) return '';
    const headingDate = formatDateOnly(currentDate, { weekday: 'long', month: 'long', day: 'numeric' });
    const sameYear = todayDate !== null && currentDate.slice(0, 4) === todayDate.slice(0, 4);
    return sameYear ? headingDate : `${headingDate}, ${currentDate.slice(0, 4)}`;
  })();

  const showStaffFilter = barbers.length >= 2;
  const hasUnassignedAppointments = appointments.some((a) => a.barber_id === null);

  const filteredAppointments =
    selectedBarberId === null
      ? appointments
      : selectedBarberId === 'unassigned'
        ? appointments.filter((a) => a.barber_id === null)
        : appointments.filter((a) => a.barber_id === selectedBarberId);

  // Separate into three visual tiers:
  //  1. Upcoming: confirmed or scheduled with a future datetime — shown first, full styling
  //  2. Past unanswered: scheduled but datetime has already passed — shown below upcoming,
  //     greyed out (AppointmentCard handles the visual, sort order communicates priority)
  //  3. Cancelled: shown last with strikethrough
  const now = new Date();
  const isPast = (a: AppointmentWithDetails) => isPastAppointment(a, now);

  const upcomingActive    = filteredAppointments.filter((a) => a.status !== 'cancelled' && !isPast(a));
  const pastUnanswered    = filteredAppointments.filter(isPast);
  const cancelledAppointments = filteredAppointments.filter((a) => a.status === 'cancelled');
  const sortedAppointments = [...upcomingActive, ...pastUnanswered, ...cancelledAppointments];

  // Pill style helper
  function pillClass(active: boolean): string {
    return [
      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors font-body',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/30',
      active
        ? 'bg-[#1B4332] text-white'
        : 'bg-[#E5E2DB]/60 text-[#4A4540] hover:bg-[#E5E2DB]',
    ].join(' ');
  }

  return (
    <div>

      {/* ===================================================================
          Optional page heading
      =================================================================== */}
      {title && (
        <div className="mb-5">
          <h1 className="font-heading text-4xl font-bold text-[#1A1A1A]">{title}</h1>
          <p className="text-sm text-[#8A8680] mt-1 font-body">{fullDateLabel}</p>
        </div>
      )}

      {/* ===================================================================
          Navigation header
      =================================================================== */}
      {title ? (
        /* Today-page nav: Add button + optional Today shortcut */
        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="
              flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
              bg-[#1B4332] text-white hover:bg-[#16392A]
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/40
            "
          >
            <Plus className="w-4 h-4" />
            Add appointment
          </button>

          {currentDate && !isCurrentlyToday && (
            <button
              onClick={handleToday}
              className="
                text-sm font-medium text-[#4A4540]
                px-3 py-2 rounded-lg border border-[#E5E2DB] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
                transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
              "
            >
              Today
            </button>
          )}
        </div>
      ) : (
        /* Day-browser nav: arrows + date heading + Add button */
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={handlePrevDay}
            aria-label="Previous day"
            className="
              p-2 rounded-lg border border-[#E5E2DB]
              text-[#8A8680] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <h2 className="flex-1 text-sm font-semibold text-[#1A1A1A] font-body">
            {fullDateLabel}
            {isCurrentlyToday && (
              <span className="ml-2 text-xs font-medium text-white bg-[#1B4332] px-2 py-0.5 rounded-full align-middle">
                Today
              </span>
            )}
          </h2>

          {currentDate && !isCurrentlyToday && (
            <button
              onClick={handleToday}
              className="
                text-sm font-medium text-[#4A4540]
                px-3 py-1.5 rounded-lg border border-[#E5E2DB] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
                transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
              "
            >
              Today
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="
              flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold
              bg-[#1B4332] text-white hover:bg-[#16392A]
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/40
            "
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add appointment</span>
            <span className="sm:hidden">Add</span>
          </button>

          <button
            onClick={handleNextDay}
            aria-label="Next day"
            className="
              p-2 rounded-lg border border-[#E5E2DB]
              text-[#8A8680] hover:text-[#1A1A1A] hover:border-[#1B4332]/30 hover:bg-[#E8F2EC]/50
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20
            "
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ===================================================================
          Staff filter pills — only when salon has 2+ staff
      =================================================================== */}
      {showStaffFilter && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button type="button" onClick={() => setSelectedBarberId(null)} className={pillClass(selectedBarberId === null)}>
            All
          </button>
          {barbers.map((b) => (
            <button key={b.id} type="button" onClick={() => setSelectedBarberId(b.id)} className={pillClass(selectedBarberId === b.id)}>
              {b.name}
            </button>
          ))}
          {hasUnassignedAppointments && (
            <button type="button" onClick={() => setSelectedBarberId('unassigned')} className={pillClass(selectedBarberId === 'unassigned')}>
              Unassigned
            </button>
          )}
        </div>
      )}

      {/* ===================================================================
          Content area
      =================================================================== */}

      {/* Loading skeleton (also shown until the salon timezone is known) */}
      {(isLoading || !currentDate) && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white rounded-xl border border-[#E5E2DB] px-5 py-4 animate-pulse">
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

      {/* Error state */}
      {!isLoading && error && currentDate && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => { if (currentDate) fetchAppointments(currentDate); }}
            className="text-sm text-red-600 underline mt-1 hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && appointments.length === 0 && (
        <p className="text-sm text-[#8A8680] py-6 font-body">No appointments today.</p>
      )}

      {/* Filtered empty state */}
      {!isLoading && !error && appointments.length > 0 && sortedAppointments.length === 0 && (
        <p className="text-sm text-[#8A8680] py-6 font-body">No appointments for this staff member today.</p>
      )}

      {/* Appointment list */}
      {!isLoading && !error && salonTimezone && sortedAppointments.length > 0 && (
        <AnimatePresence mode="popLayout">
          <div className="space-y-2">
            {sortedAppointments.map((appointment, i) => (
              <motion.div
                key={appointment.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04, ease: 'easeOut' }}
              >
                <AppointmentCard
                  appointment={appointment}
                  onClick={() => handleOpenEditModal(appointment)}
                  timezone={salonTimezone}
                />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* ===================================================================
          Add/Edit modal
      =================================================================== */}
      {salonTimezone && (
        <AddAppointmentModal
          isOpen={modalOpen}
          onClose={handleModalClose}
          onSaved={handleModalSaved}
          timezone={salonTimezone}
          initialDate={currentDate ?? undefined}
          appointment={editingAppointment ?? undefined}
        />
      )}
    </div>
  );
}
