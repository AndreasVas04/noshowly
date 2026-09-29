/**
 * app/book/[slug]/BookingFlow.tsx
 *
 * Multi-step public booking flow. Client component — handles all interactivity
 * for the public booking page.
 *
 * Steps:
 *  0. staff    — Select a staff member, or "Any available staff" when more than
 *                one can be booked (skipped when only one staff member)
 *  1. service  — Select a service the chosen staff member can perform
 *  2. datetime — Pick a date (calendar), then pick a time slot
 *  3. details  — Enter name + required contact fields (controlled per booking page settings)
 *  4. success  — Booking confirmed; option to download .ics calendar file
 *
 * Steps with no choices are auto-skipped.
 *
 * Bookable times come from the shared rules in lib/availability.ts, the same
 * rules POST /api/book/[slug]/appointments enforces:
 *  - the whole appointment, with the staff member's own duration, must fit in
 *    one of their working intervals and inside the salon's opening hours;
 *  - it must not overlap their other appointments (busy times are fetched
 *    per date);
 *  - it must start at least MIN_NOTICE_MINUTES from now and at most
 *    MAX_ADVANCE_DAYS ahead.
 * With "Any available staff", a time is offered when any eligible staff member
 * is free; the server assigns the one with the fewest appointments that day.
 *
 * All dates and times are in the salon's timezone, and the page says so.
 *
 * Noshowly branding is completely invisible — clients see only the salon's name.
 */

'use client';

import { useState, useEffect, useSyncExternalStore, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_OPENING_HOURS,
  eligibleBarberIds,
  getAvailableSlots,
  getBookableIntervals,
  getEffectiveDuration,
  getEffectivePrice,
  getSalonHoursInterval,
  isBarberEligibleForService,
  isDateWithinBookingWindow,
  lastBookableDate,
  type SlotCandidate,
} from '@/lib/availability';
import { MAX_PHONE_INPUT_LENGTH, validateEmail, validatePhone } from '@/lib/contact';
import { getCurrencySymbol } from '@/lib/currency';
import {
  dayOfWeekForDate,
  formatDateOnly,
  formatTimeZoneLabel,
  resolveZonedTime,
  todayInZone,
} from '@/lib/time';
import { getInitials } from '@/lib/utils';
import type {
  PublicAvailability,
  PublicBarber,
  PublicBusyInterval,
  PublicSalon,
  PublicService,
  PublicServiceAssignment,
} from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'staff' | 'service' | 'datetime' | 'details' | 'success';

/**
 * The visitor's staff choice: a specific person, 'any' ("Any available
 * staff"), or null before choosing and for salons without staff.
 */
type StaffChoice = PublicBarber | 'any' | null;

/** Details returned by the booking API once the appointment exists. */
type ConfirmedBooking = {
  appointmentId: string;
  /** Staff member the appointment was booked with (assigned by the server for "any"). */
  barberName: string | null;
  durationMinutes: number;
};

type Props = {
  slug: string;
  /** Custom h1 heading for the public booking page. Falls back to salon name. */
  customTitle: string | null;
  /** Optional welcome message shown below the title. */
  customIntro: string | null;
  /** Whether clients must supply a phone number. Controlled by booking page settings. */
  requirePhone: boolean;
  /** Whether clients must supply an email address. Controlled by booking page settings. */
  requireEmail: boolean;
  /** Salon info; timezone is a valid IANA name and hours are 'HH:MM' or null. */
  salon: PublicSalon;
  /** Active staff, ordered by name. */
  barbers: PublicBarber[];
  /** Active global services for this salon, ordered by name. */
  globalServices: PublicService[];
  /** All staff/service links of the salon (from barber_services), with overrides. */
  barberServiceAssignments: PublicServiceAssignment[];
  /** Weekly availability of the active staff. */
  staffAvailability: PublicAvailability[];
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Formats "14:30" → "2:30 PM". */
function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

/**
 * Formats "2026-04-15" → "Wednesday, April 15".
 * Formats in UTC so the day shown is the date itself, in every browser timezone.
 */
function formatDateLong(dateStr: string): string {
  return formatDateOnly(dateStr, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Formats a set of numbers as a single value or a range, e.g. "30" or "30–45".
 *
 * @param values - Numbers to summarise.
 * @param format - Formats one number.
 * @returns      The label, or null when there are no values.
 */
function formatRange(values: number[], format: (n: number) => string): string | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : `${format(min)}–${format(max)}`;
}

/**
 * Builds an iCalendar (.ics) file string for the booked appointment.
 *
 * @param salonName       - Name of the salon (shown in the event title).
 * @param service         - Service name.
 * @param start           - Appointment start instant.
 * @param durationMinutes - Appointment length in minutes.
 * @returns               iCalendar text content.
 */
function buildICS(
  salonName: string,
  service: string,
  start: Date,
  durationMinutes: number,
): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${service || 'Appointment'} at ${salonName}`,
    `DESCRIPTION:Your appointment at ${salonName}.`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Current time
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

/**
 * Calls `onMinute` at the start of every minute until unsubscribed.
 *
 * @param onMinute - Called when a new minute starts.
 * @returns        Unsubscribe function.
 */
function subscribeToMinutes(onMinute: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onMinute();
      schedule();
    }, MINUTE_MS - (Date.now() % MINUTE_MS));
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Start of the current minute, in milliseconds since the epoch. */
function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/** No current time during the server render (and hydration), so it never depends on the clock. */
function noMinuteOnServer(): number | null {
  return null;
}

// ---------------------------------------------------------------------------
// Calendar sub-component
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/**
 * A simple month-grid calendar for picking a salon date.
 * Dates outside the booking window or with no bookable staff are greyed out.
 *
 * @param selected     - Currently selected YYYY-MM-DD date, or null.
 * @param onSelect     - Callback when a date is clicked.
 * @param today        - Today's date in the salon timezone.
 * @param lastDate     - Last bookable date in the salon timezone.
 * @param isSelectable - Returns false for dates that cannot be booked.
 */
function CalendarPicker({
  selected,
  onSelect,
  today,
  lastDate,
  isSelectable,
}: {
  selected: string | null;
  onSelect: (date: string) => void;
  today: string;
  lastDate: string;
  isSelectable: (dateStr: string) => boolean;
}) {
  const initial = selected ?? today;
  const [viewYear, setViewYear]   = useState(() => Number(initial.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(initial.slice(5, 7)) - 1);

  const daysInMonth    = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const leadingEmpty   = Array.from({ length: firstDayOfWeek });

  const monthKey     = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}`;
  const canGoBack    = monthKey > today.slice(0, 7);
  const canGoForward = monthKey < lastDate.slice(0, 7);

  function prevMonth() {
    if (!canGoBack) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (!canGoForward) return;
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  return (
    <div className="w-full max-w-xs mx-auto">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-5">
        <button
          type="button"
          onClick={prevMonth}
          disabled={!canGoBack}
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous month"
        >
          &#8592;
        </button>
        <span className="font-body text-sm font-semibold text-[#1A1A1A] tracking-wide">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={!canGoForward}
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next month"
        >
          &#8594;
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] text-[#8A8680] font-semibold py-1 tracking-wider">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {leadingEmpty.map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day        = i + 1;
          const dateStr    = `${monthKey}-${day.toString().padStart(2, '0')}`;
          const isDisabled = !isSelectable(dateStr);
          const isToday    = dateStr === today;
          const isSelected = dateStr === selected;

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(dateStr)}
              className={[
                'aspect-square relative flex flex-col items-center justify-center text-sm rounded-full transition-colors font-body',
                isDisabled
                  ? 'text-[#8A8680]/40 cursor-not-allowed'
                  : isSelected
                    ? 'bg-[#1B4332] text-white font-semibold'
                    : isToday
                      ? 'text-[#1B4332] font-semibold hover:bg-[#E8F2EC]/60'
                      : 'text-[#1A1A1A] hover:bg-[#E8F2EC]/50',
              ].join(' ')}
            >
              {day}
              {isToday && !isSelected && (
                <span className="absolute bottom-[3px] w-1 h-1 rounded-full bg-[#1B4332]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BookingFlow (main component)
// ---------------------------------------------------------------------------

/**
 * Multi-step booking flow for the public booking page.
 * All state is local. Calls POST /api/book/[slug]/appointments on submit.
 */
export default function BookingFlow({
  slug,
  customTitle,
  customIntro,
  requirePhone,
  requireEmail,
  salon,
  barbers,
  globalServices,
  barberServiceAssignments,
  staffAvailability,
}: Props) {
  const currencySymbol = getCurrencySymbol(salon.currency);
  const timeZone = salon.timezone;
  const salonHours = { opening_time: salon.opening_time, closing_time: salon.closing_time };

  // -------------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------------

  /** Salons with active staff always book a specific staff member. */
  const salonHasStaff = barbers.length > 0;

  /**
   * Staff members who can be booked: with services configured, only those who
   * can perform at least one active service.
   */
  const bookableBarbers =
    globalServices.length === 0
      ? barbers
      : barbers.filter((b) =>
          globalServices.some((s) => isBarberEligibleForService(s.id, b.id, barberServiceAssignments))
        );
  const bookableBarberIds = bookableBarbers.map((b) => b.id);

  /** "Any available staff" is offered when there is more than one person to choose from. */
  const offerAnyStaff = bookableBarbers.length > 1;

  /** True when the staff step has a real choice to make. */
  const hasStaffChoice = salonHasStaff && bookableBarbers.length !== 1;

  // -------------------------------------------------------------------------
  // Step navigation and booking selections
  // -------------------------------------------------------------------------

  const [step, setStep] = useState<Step>(() => {
    if (hasStaffChoice) return 'staff';
    return globalServices.length > 0 ? 'service' : 'datetime';
  });

  const [selectedStaff, setSelectedStaff] = useState<StaffChoice>(() =>
    salonHasStaff && bookableBarbers.length === 1 ? bookableBarbers[0] : null
  );
  const [selectedService, setSelectedService] = useState<PublicService | null>(null);
  const [selectedDate,    setSelectedDate]    = useState<string | null>(null);
  const [selectedTime,    setSelectedTime]    = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Client details
  // -------------------------------------------------------------------------

  const [clientName,   setClientName]   = useState('');
  const [clientPhone,  setClientPhone]  = useState('');
  const [clientEmail,  setClientEmail]  = useState('');
  const [clientNotes,  setClientNotes]  = useState('');
  /**
   * Honeypot: hidden from people, so it must stay empty. Bots tend to fill it in.
   * Its name means nothing to browser autofill, which could fill a field such
   * as "company" even though it is hidden.
   */
  const [honeypot,     setHoneypot]     = useState('');
  const [detailsError, setDetailsError] = useState('');

  // -------------------------------------------------------------------------
  // Current time (client-only, so the server render never depends on it)
  // -------------------------------------------------------------------------

  /** Start of the current minute, updated every minute; null until hydrated. */
  const minute = useSyncExternalStore<number | null>(subscribeToMinutes, currentMinute, noMinuteOnServer);
  const now = minute === null ? null : new Date(minute);

  // -------------------------------------------------------------------------
  // Busy times (fetched per selected date)
  // -------------------------------------------------------------------------

  const [busy,         setBusy]         = useState<PublicBusyInterval[]>([]);
  const [slotsError,   setSlotsError]   = useState('');
  /** Incremented to (re)load the selected date's busy times. */
  const [busyRequestCount, setBusyRequestCount] = useState(0);
  /** The request whose response `busy` and `slotsError` hold. */
  const [loadedBusyRequest, setLoadedBusyRequest] = useState<string | null>(null);

  /** Identifies the busy-times request for the selected date; null when no date is selected. */
  const busyRequest = selectedDate ? `${selectedDate}#${busyRequestCount}` : null;
  const loadingSlots = busyRequest !== null && loadedBusyRequest !== busyRequest;

  // -------------------------------------------------------------------------
  // Submit state
  // -------------------------------------------------------------------------

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);

  // -------------------------------------------------------------------------
  // Derived selection data
  // -------------------------------------------------------------------------

  const specificBarber = selectedStaff && selectedStaff !== 'any' ? selectedStaff : null;

  /**
   * Services the visitor can pick:
   *  - specific staff member: the services they are eligible for;
   *  - "any" (or not chosen yet): services at least one bookable staff member can perform;
   *  - salon without staff: every active service.
   */
  const availableServices: PublicService[] = !salonHasStaff
    ? globalServices
    : specificBarber
      ? globalServices.filter((s) => isBarberEligibleForService(s.id, specificBarber.id, barberServiceAssignments))
      : globalServices.filter((s) => eligibleBarberIds(s.id, bookableBarberIds, barberServiceAssignments).length > 0);

  /**
   * Staff ids a service could be booked with for the current staff choice.
   *
   * @param serviceId - Service, or null when none is selected.
   */
  function staffIdsFor(serviceId: string | null): string[] {
    if (!salonHasStaff) return [];
    if (specificBarber) return [specificBarber.id];
    return eligibleBarberIds(serviceId, bookableBarberIds, barberServiceAssignments);
  }

  /**
   * Builds the slot candidates for a date: one per eligible staff member with
   * their bookable intervals and own duration, or a single staff-less
   * candidate working the salon hours for salons without staff.
   *
   * @param date - 'YYYY-MM-DD' in the salon timezone.
   */
  function buildCandidates(date: string): SlotCandidate[] {
    const dayOfWeek = dayOfWeekForDate(date);
    if (!salonHasStaff) {
      return [{
        barberId: null,
        intervals: [getSalonHoursInterval(salonHours) ?? DEFAULT_OPENING_HOURS],
        durationMinutes: getEffectiveDuration(selectedService, null, barberServiceAssignments),
      }];
    }
    return staffIdsFor(selectedService?.id ?? null).map((barberId) => ({
      barberId,
      intervals: getBookableIntervals(barberId, dayOfWeek, staffAvailability, salonHours),
      durationMinutes: getEffectiveDuration(selectedService, barberId, barberServiceAssignments),
    }));
  }

  /**
   * Returns the duration label for a service with the current staff choice,
   * e.g. "45" or "30–45" when staff overrides differ. Null when neither the
   * service nor any override defines a duration.
   *
   * @param service - The service.
   */
  function serviceDurationLabel(service: PublicService): string | null {
    const ids: Array<string | null> = salonHasStaff ? staffIdsFor(service.id) : [null];
    const defined =
      service.duration_minutes != null ||
      barberServiceAssignments.some(
        (a) => a.service_id === service.id && a.duration_minutes_override != null && ids.includes(a.barber_id)
      );
    if (!defined) return null;
    return formatRange(
      (ids.length > 0 ? ids : [null]).map((id) => getEffectiveDuration(service, id, barberServiceAssignments)),
      (n) => `${n}`,
    );
  }

  /**
   * Returns the price label for a service with the current staff choice,
   * e.g. "€25.00" or "€20.00–€25.00". Null when no price is set.
   *
   * @param service - The service.
   */
  function servicePriceLabel(service: PublicService): string | null {
    const ids: Array<string | null> = salonHasStaff ? staffIdsFor(service.id) : [null];
    const prices = (ids.length > 0 ? ids : [null])
      .map((id) => getEffectivePrice(service, id, barberServiceAssignments))
      .filter((p): p is number => p !== null);
    return formatRange(prices, (n) => `${currencySymbol}${n.toFixed(2)}`);
  }

  const today    = now ? todayInZone(timeZone, now) : null;
  const lastDate = now ? lastBookableDate(timeZone, now) : null;

  /**
   * Returns true when a date can be picked: inside the booking window and at
   * least one candidate works that day.
   *
   * @param date - 'YYYY-MM-DD' in the salon timezone.
   */
  function isDateSelectable(date: string): boolean {
    if (!now || !isDateWithinBookingWindow(date, timeZone, now)) return false;
    return buildCandidates(date).some((c) => c.intervals.length > 0);
  }

  /** Bookable start times on the selected date. */
  const timeSlots: string[] =
    now && selectedDate && !loadingSlots && !slotsError
      ? getAvailableSlots({
          date: selectedDate,
          timeZone,
          candidates: buildCandidates(selectedDate),
          busy,
          now,
        }).map((slot) => slot.time)
      : [];

  // While picking a time, drop a selection that is no longer offered
  // (e.g. it fell inside the minimum notice as time passed).
  if (step === 'datetime' && !loadingSlots && selectedTime && !timeSlots.includes(selectedTime)) {
    setSelectedTime(null);
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setDetailsError('');
    setSubmitError('');

    const name  = clientName.trim();
    const phone = clientPhone.trim();
    const email = clientEmail.trim();
    const notes = clientNotes.trim();

    if (!name) { setDetailsError('Your name is required.'); return; }

    if (requirePhone && !phone) {
      setDetailsError('Your phone number is required.');
      return;
    }
    if (phone) {
      const phoneCheck = validatePhone(phone);
      if (!phoneCheck.ok) { setDetailsError(`${phoneCheck.error}.`); return; }
    }
    if (requireEmail && !email) {
      setDetailsError('Your email is required to receive email reminders.');
      return;
    }
    if (email) {
      const emailCheck = validateEmail(email);
      if (!emailCheck.ok) { setDetailsError(`${emailCheck.error}.`); return; }
    }
    if (!selectedDate || !selectedTime) {
      setDetailsError('Please select a date and time.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}/appointments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:   selectedService?.id ?? null,
          // null = "Any available staff" (or no staff): the server assigns.
          barber_id:    specificBarber?.id ?? null,
          date:         selectedDate,
          time:         selectedTime,
          client_name:  name,
          client_phone: phone || null,
          client_email: email || null,
          notes:        notes || null,
          hp_field:     honeypot,
        }),
      });

      if (!res.ok) {
        let errMsg = 'Something went wrong. Please try again.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errMsg = data.error;
        } catch {
          // Server returned non-JSON (e.g. Next.js HTML error page) — log status for debugging.
          console.error('[BookingFlow] server returned non-JSON error — status:', res.status, res.statusText);
          errMsg = `Server error (${res.status}). Please try again.`;
        }
        setSubmitError(errMsg);
        // The time was taken in the meantime: refresh so it disappears from the list.
        if (res.status === 409) setBusyRequestCount((count) => count + 1);
        return;
      }

      const data = (await res.json()) as {
        appointmentId: string;
        barberName?: string | null;
        durationMinutes?: number;
      };
      setConfirmed({
        appointmentId:   data.appointmentId,
        barberName:      data.barberName ?? specificBarber?.name ?? null,
        durationMinutes: data.durationMinutes ?? getEffectiveDuration(selectedService, specificBarber?.id, barberServiceAssignments),
      });
      setStep('success');
    } catch (err) {
      console.error('[BookingFlow] fetch error:', err);
      setSubmitError('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // .ics download
  // -------------------------------------------------------------------------

  function handleDownloadICS(): void {
    if (!selectedDate || !selectedTime || !confirmed) return;
    const start = resolveZonedTime(selectedDate, selectedTime, timeZone);
    if (!start.ok) return;
    const service = selectedService?.name ?? 'Appointment';
    const ics = buildICS(salon.name, service, start.date, confirmed.durationMinutes);
    downloadFile(ics, 'appointment.ics', 'text/calendar');
  }

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  /**
   * Selects a staff member (or "any") and advances to the next step.
   * If global services exist, go to service step; otherwise skip to datetime.
   *
   * @param choice - The selected staff member, or 'any'.
   */
  function handleSelectStaff(choice: PublicBarber | 'any') {
    setSelectedStaff(choice);
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep(globalServices.length > 0 ? 'service' : 'datetime');
  }

  /**
   * Selects a date: clears the chosen time and loads the date's busy times.
   *
   * @param date - 'YYYY-MM-DD' in the salon timezone.
   */
  function handleSelectDate(date: string) {
    if (date === selectedDate) return;
    setSelectedDate(date);
    setSelectedTime(null);
    setBusyRequestCount((count) => count + 1);
  }

  /**
   * Selects a service and advances to the date step. The chosen time is
   * cleared because the duration (and so the free times) may differ.
   *
   * @param service - The selected service.
   */
  function handleSelectService(service: PublicService) {
    setSelectedService(service);
    setSelectedTime(null);
    setStep('datetime');
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Sidebar step list — only show the Staff step when there is a choice to make.
  const FLOW_STEPS: { id: Step; label: string }[] = [
    ...(hasStaffChoice ? [{ id: 'staff' as Step, label: 'Staff member' }] : []),
    ...(globalServices.length > 0 ? [{ id: 'service' as Step, label: 'Service' }] : []),
    { id: 'datetime' as Step, label: 'Date & time' },
    { id: 'details' as Step, label: 'Your details' },
  ];

  const stepOrder: Step[] = ['staff', 'service', 'datetime', 'details', 'success'];
  const currentStepIdx = stepOrder.indexOf(step);

  /** Returns display status of a sidebar step. */
  function stepStatus(s: Step): 'active' | 'complete' | 'upcoming' {
    const idx = stepOrder.indexOf(s);
    if (idx === currentStepIdx) return 'active';
    if (idx < currentStepIdx) return 'complete';
    return 'upcoming';
  }

  /** Who the appointment is with, for the summaries. */
  const staffLabel: string | null =
    confirmed?.barberName
      ? `with ${confirmed.barberName}`
      : specificBarber
        ? `with ${specificBarber.name}`
        : selectedStaff === 'any'
          ? 'Any available staff'
          : null;

  const selectedServiceDuration = selectedService ? serviceDurationLabel(selectedService) : null;
  const selectedServicePrice    = selectedService ? servicePriceLabel(selectedService) : null;

  /** Booking summary lines for sidebar. */
  const hasSummary =
    selectedService !== null ||
    staffLabel !== null ||
    selectedDate !== null ||
    selectedTime !== null;

  const timeZoneNote = `Times are shown in ${formatTimeZoneLabel(timeZone)} time.`;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── DESKTOP SIDEBAR ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-[280px] shrink-0 sticky top-0 self-start h-screen overflow-y-auto" style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}>
        <div className="flex flex-col h-full p-7 gap-0">

          {/* Business name */}
          <h1 className="font-heading text-white text-[16px] font-bold leading-snug mt-1">
            {customTitle ?? salon.name}
          </h1>
          {customIntro && (
            <p className="mt-3 font-body text-[12px] text-white/55 leading-relaxed tracking-wide">
              {customIntro}
            </p>
          )}

          {/* Live booking summary */}
          {hasSummary && (
            <div className="mt-6 pt-5 border-t border-white/10 space-y-2">
              <p className="font-body text-[10px] text-white/30 uppercase tracking-widest">Your booking</p>
              {selectedService && (
                <div>
                  <p className="font-body text-white text-sm font-semibold leading-snug">
                    {selectedService.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {selectedServiceDuration && (
                      <span className="font-body text-white/40 text-[11px]">
                        {selectedServiceDuration} min
                      </span>
                    )}
                    {selectedServicePrice && (
                      <span className="font-body text-white/60 text-[11px] font-medium">
                        {selectedServicePrice}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {staffLabel && (
                <p className="font-body text-white/50 text-[11px]">{staffLabel}</p>
              )}
              {selectedDate && (
                <p className="font-body text-white/60 text-[11px]">{formatDateLong(selectedDate)}</p>
              )}
              {selectedTime && (
                <p className="font-body text-white text-sm font-semibold">{formatTime12h(selectedTime)}</p>
              )}
            </div>
          )}

          {/* Vertical step list — pushed to bottom */}
          <nav className="mt-auto pt-8">
            <ol className="space-y-3.5">
              {FLOW_STEPS.map(({ id, label }) => {
                const status = stepStatus(id);
                return (
                  <li key={id} className="flex items-center gap-3">
                    {/* Step circle: complete = white filled + dark ✓, active = white + dark border, upcoming = empty grey ring */}
                    <div
                      className={[
                        'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition-all',
                        status === 'active'   ? 'bg-transparent border-2 border-white'        :
                        status === 'complete' ? 'bg-white text-[#1B4332] text-[10px] font-bold' :
                                               'border-2 border-white/20 bg-transparent',
                      ].join(' ')}
                    >
                      {status === 'complete' ? '✓' : ''}
                    </div>
                    <span
                      className={[
                        'font-body text-[13px] transition-all',
                        status === 'active'   ? 'text-white font-medium'  :
                        status === 'complete' ? 'text-white/40'           :
                                               'text-white/20',
                      ].join(' ')}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </aside>

      {/* ── MOBILE HERO ─────────────────────────────────────────────────────── */}
      <div className="lg:hidden px-6 py-8" style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}>
        <h1 className="font-heading text-2xl font-bold text-white">
          {customTitle ?? salon.name}
        </h1>
        {customIntro && (
          <p className="font-body text-sm text-white/60 leading-relaxed mt-2">
            {customIntro}
          </p>
        )}
      </div>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <main className="flex-1 bg-[#FAFAF8] min-h-screen">
        <div className="max-w-[560px] mx-auto px-5 lg:px-8 py-10 space-y-5">

          {/* ----------------------------------------------------------------
              STEP: staff selection
          ---------------------------------------------------------------- */}
          {step === 'staff' && (
            <div className="bg-white rounded-2xl border border-[#E5E2DB] overflow-hidden shadow-sm">
              <div className="px-6 pt-6 pb-5 border-b border-[#E5E2DB]/40">
                <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">
                  Select a staff member
                </h2>
                <p className="font-body text-sm text-[#8A8680] mt-1">Choose who you'd like to see</p>
              </div>

              {bookableBarbers.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="font-body text-sm text-[#8A8680]">
                    Online booking is not available right now. Please contact us directly.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E5E2DB]/60">
                  {offerAnyStaff && (
                    <button
                      type="button"
                      onClick={() => handleSelectStaff('any')}
                      className="w-full flex items-center gap-4 px-6 py-5 hover:bg-[#F5FAF7] transition-colors text-left group"
                    >
                      <div className="w-14 h-14 rounded-full bg-[#F5F3EF] border-2 border-transparent group-hover:border-[#1B4332]/30 flex items-center justify-center text-lg text-[#1B4332] shrink-0 transition-colors">
                        &#10033;
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-sm font-semibold text-[#1A1A1A]">Any available staff</p>
                        <p className="font-body text-xs text-[#8A8680] mt-0.5">See every free time and we&apos;ll assign someone</p>
                      </div>
                      <span className="text-[#8A8680] group-hover:text-[#1B4332] transition-colors shrink-0">&#8594;</span>
                    </button>
                  )}
                  {bookableBarbers.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectStaff(b)}
                      className="w-full flex items-center gap-4 px-6 py-5 hover:bg-[#F5FAF7] transition-colors text-left group"
                    >
                      {b.photo_url ? (
                        <img
                          src={b.photo_url}
                          alt={b.name}
                          className="w-14 h-14 rounded-full object-cover shrink-0 border-2 border-[#E5E2DB] group-hover:border-[#1B4332]/40 transition-colors"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-[#E8F2EC] border-2 border-transparent group-hover:border-[#1B4332]/30 flex items-center justify-center text-sm font-semibold text-[#1B4332] shrink-0 transition-colors">
                          {getInitials(b.name)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-sm font-semibold text-[#1A1A1A]">{b.name}</p>
                        {b.bio && (
                          <p className="font-body text-xs text-[#8A8680] mt-0.5 line-clamp-2">{b.bio}</p>
                        )}
                      </div>
                      <span className="text-[#8A8680] group-hover:text-[#1B4332] transition-colors shrink-0">&#8594;</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: service selection
          ---------------------------------------------------------------- */}
          {step === 'service' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#E5E2DB] overflow-hidden shadow-sm">
                <div className="px-6 pt-6 pb-5 border-b border-[#E5E2DB]/40">
                  <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">Choose a service</h2>
                  <p className="font-body text-sm text-[#8A8680] mt-1">Select what you'd like to book</p>
                </div>

                {availableServices.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="font-body text-sm text-[#8A8680]">No services are available for this selection.</p>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {availableServices.map((svc) => {
                        // Effective price/duration: the staff member's overrides when one is selected.
                        const durationLabel = serviceDurationLabel(svc);
                        const priceLabel = servicePriceLabel(svc);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            onClick={() => handleSelectService(svc)}
                            className="text-left p-5 rounded-xl border border-[#E5E2DB] hover:border-[#1B4332]/50 hover:bg-[#E8F2EC]/20 hover:shadow-sm transition-all group"
                          >
                            <p className="font-body text-sm font-semibold text-[#1A1A1A] leading-snug mb-3">
                              {svc.name}
                            </p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {durationLabel && (
                                  <span className="font-body text-[11px] bg-[#F5F3EF] text-[#4A4540] px-2.5 py-1 rounded-full font-medium">
                                    {durationLabel} min
                                  </span>
                                )}
                              </div>
                              {priceLabel && (
                                <span className="font-body text-sm font-semibold text-[#1B4332]">
                                  {priceLabel}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {hasStaffChoice && (
                <button
                  type="button"
                  onClick={() => { setSelectedService(null); setStep('staff'); }}
                  className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
                >
                  &#8592; Change staff member
                </button>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: date + time
          ---------------------------------------------------------------- */}
          {step === 'datetime' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 shadow-sm">
                <h2 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-6">Pick a date</h2>
                {today && lastDate ? (
                  <CalendarPicker
                    selected={selectedDate}
                    onSelect={handleSelectDate}
                    today={today}
                    lastDate={lastDate}
                    isSelectable={isDateSelectable}
                  />
                ) : (
                  <div className="h-64" />
                )}
              </div>

              {selectedDate && (
                <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 shadow-sm">
                  <h2 className="font-heading text-lg font-bold text-[#1A1A1A] mb-0.5">Available times</h2>
                  <p className="font-body text-xs text-[#8A8680]">{formatDateLong(selectedDate)}</p>
                  <p className="font-body text-xs text-[#8A8680] mb-5">{timeZoneNote}</p>

                  {loadingSlots ? (
                    <div className="flex items-center gap-2 text-[#8A8680]">
                      <div className="w-4 h-4 border-2 border-[#E5E2DB] border-t-[#1B4332] rounded-full animate-spin" />
                      <p className="font-body text-sm">Loading available times...</p>
                    </div>
                  ) : slotsError ? (
                    <div className="space-y-2">
                      <p className="font-body text-sm text-red-700">{slotsError}</p>
                      <button
                        type="button"
                        onClick={() => setBusyRequestCount((count) => count + 1)}
                        className="font-body text-sm text-[#1B4332] underline underline-offset-2"
                      >
                        Try again
                      </button>
                    </div>
                  ) : timeSlots.length === 0 ? (
                    <p className="font-body text-sm text-[#8A8680]">No times available on this day. Please choose another date.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {timeSlots.map((slot) => {
                        const isActive = selectedTime === slot;

                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setSelectedTime(slot)}
                            className={[
                              'flex items-center justify-center py-3.5 px-3 rounded-xl border transition-all',
                              isActive
                                ? 'bg-[#1B4332] text-white border-[#1B4332] shadow-sm'
                                : 'border-[#E5E2DB] text-[#1A1A1A] hover:border-[#1B4332]/40 hover:bg-[#E8F2EC]/50 hover:shadow-sm',
                            ].join(' ')}
                          >
                            <span className="font-body text-xs font-semibold">
                              {formatTime12h(slot)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (globalServices.length > 0) {
                      setStep('service');
                    } else if (hasStaffChoice) {
                      setStep('staff');
                    }
                  }}
                  className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
                >
                  &#8592; Back
                </button>

                <Button
                  type="button"
                  disabled={!selectedDate || !selectedTime}
                  onClick={() => setStep('details')}
                  className="bg-[#1B4332] hover:bg-[#16392A] text-white px-6 py-2.5 h-auto disabled:opacity-40 font-body"
                >
                  Continue &#8594;
                </Button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: client details
          ---------------------------------------------------------------- */}
          {step === 'details' && (
            <div className="space-y-4">
              {/* Booking summary card */}
              <div className="bg-white rounded-2xl border border-[#E5E2DB] border-l-[3px] border-l-[#1B4332] p-5 shadow-sm">
                <p className="font-body text-[10px] font-semibold text-[#8A8680] uppercase tracking-widest mb-3">
                  Your booking
                </p>
                <div className="space-y-1.5">
                  {selectedService && (
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-body text-sm font-semibold text-[#1A1A1A]">
                        {selectedService.name}
                        {selectedServiceDuration && (
                          <span className="text-[#8A8680] font-normal"> &middot; {selectedServiceDuration} min</span>
                        )}
                      </p>
                      {selectedServicePrice && (
                        <span className="font-body text-sm font-semibold text-[#1B4332] shrink-0">
                          {selectedServicePrice}
                        </span>
                      )}
                    </div>
                  )}
                  {staffLabel && (
                    <p className="font-body text-sm text-[#8A8680]">{staffLabel}</p>
                  )}
                  {selectedDate && selectedTime && (
                    <p className="font-body text-sm text-[#1A1A1A] font-medium">
                      {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                    </p>
                  )}
                  <p className="font-body text-xs text-[#8A8680]">{timeZoneNote}</p>
                  <p className="font-body text-xs text-[#8A8680]">{customTitle ?? salon.name}</p>
                </div>
              </div>

              {/* Details form */}
              <form
                onSubmit={(e) => void handleSubmit(e)}
                noValidate
                className="relative bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5 shadow-sm"
              >
                <div>
                  <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">Your details</h2>
                  <p className="font-body text-sm text-[#8A8680] mt-1">We'll use this to confirm your booking</p>
                </div>
                <hr className="border-[#E5E2DB]" />

                {/* Full name */}
                <div className="space-y-1.5">
                  <Label htmlFor="client-name" className="font-body text-sm font-medium text-[#1A1A1A]">
                    Full name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="client-name"
                    type="text"
                    value={clientName}
                    onChange={(e) => { setClientName(e.target.value); setDetailsError(''); }}
                    placeholder="Jane Smith"
                    maxLength={100}
                    required
                    autoComplete="name"
                    className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <Label htmlFor="client-phone" className="font-body text-sm font-medium text-[#1A1A1A]">
                    Phone number{' '}
                    {requirePhone
                      ? <span className="text-red-500">*</span>
                      : <span className="font-body text-[#8A8680] font-normal">(optional)</span>}
                  </Label>
                  <Input
                    id="client-phone"
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => { setClientPhone(e.target.value); setDetailsError(''); }}
                    placeholder="+357 99 123 456"
                    maxLength={MAX_PHONE_INPUT_LENGTH}
                    autoComplete="tel"
                    className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                  />
                  <p className="font-body text-xs text-[#8A8680]">
                    Include your country code (e.g. +1, +357).
                  </p>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="client-email" className="font-body text-sm font-medium text-[#1A1A1A]">
                    Email{' '}
                    {requireEmail
                      ? <span className="text-red-500">*</span>
                      : <span className="font-body text-[#8A8680] font-normal">(optional)</span>}
                  </Label>
                  <Input
                    id="client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => { setClientEmail(e.target.value); setDetailsError(''); }}
                    placeholder="jane@example.com"
                    maxLength={254}
                    autoComplete="email"
                    className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                  />
                  {requireEmail && (
                    <p className="font-body text-xs text-[#8A8680]">Required for email reminders.</p>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label htmlFor="client-notes" className="font-body text-sm font-medium text-[#1A1A1A]">
                    Notes <span className="font-body text-[#8A8680] font-normal">(optional)</span>
                  </Label>
                  <textarea
                    id="client-notes"
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    placeholder="Any special requests or information..."
                    rows={2}
                    maxLength={500}
                    className="font-body w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] resize-none transition-colors"
                  />
                </div>

                {/* Honeypot — invisible to people and skipped by keyboard navigation. */}
                <div
                  aria-hidden="true"
                  className="absolute left-[-10000px] top-auto w-px h-px overflow-hidden"
                >
                  <label htmlFor="hp_field">Leave this field empty</label>
                  <input
                    id="hp_field"
                    name="hp_field"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {detailsError && (
                  <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 font-body text-sm text-red-700">
                    {detailsError}
                  </div>
                )}

                {submitError && (
                  <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 font-body text-sm text-red-700">
                    {submitError}
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-12 bg-[#1B4332] hover:bg-[#16392A] text-white font-body text-sm font-semibold rounded-xl"
                  >
                    {submitting ? 'Booking...' : 'Book appointment'}
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => { setSubmitError(''); setStep('datetime'); }}
                      className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
                    >
                      &#8592; Back
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: success
          ---------------------------------------------------------------- */}
          {step === 'success' && (
            <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 text-center space-y-6">
              {/* Animated checkmark */}
              <div className="w-20 h-20 rounded-full bg-[#E8F2EC] flex items-center justify-center mx-auto">
                <svg
                  viewBox="0 0 48 48"
                  fill="none"
                  stroke="#1B4332"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-10 h-10"
                >
                  <style>{`
                    @keyframes noshowly-check {
                      from { stroke-dashoffset: 60; opacity: 0; }
                      to   { stroke-dashoffset: 0;  opacity: 1; }
                    }
                  `}</style>
                  <polyline
                    points="10 25 20 35 38 14"
                    style={{
                      strokeDasharray: 60,
                      strokeDashoffset: 0,
                      animation: 'noshowly-check 0.5s ease-out forwards',
                    }}
                  />
                </svg>
              </div>

              <div>
                <h2 className="font-heading text-3xl font-bold text-[#1A1A1A]">
                  {"You're booked!"}
                </h2>
                <p className="font-body text-sm text-[#8A8680] mt-2">
                  {customTitle ?? salon.name} will be in touch if anything changes.
                </p>
              </div>

              {/* Booking summary */}
              <div className="bg-[#F0F7F4] rounded-xl p-5 text-left space-y-2">
                {selectedService && (
                  <div className="flex items-center justify-between">
                    <p className="font-body text-sm font-semibold text-[#1A1A1A]">{selectedService.name}</p>
                    {selectedServicePrice && (
                      <p className="font-body text-sm text-[#1A1A1A]">
                        {selectedServicePrice}
                      </p>
                    )}
                  </div>
                )}
                {staffLabel && (
                  <p className="font-body text-sm text-[#8A8680]">{staffLabel}</p>
                )}
                {selectedDate && selectedTime && (
                  <p className="font-body text-sm font-medium text-[#1A1A1A]">
                    {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                  </p>
                )}
                <p className="font-body text-xs text-[#8A8680]">{timeZoneNote}</p>
                <p className="font-body text-sm text-[#8A8680]">{customTitle ?? salon.name}</p>
              </div>

              <p className="font-body text-xs text-[#8A8680]">
                {"You'll receive a reminder before your appointment."}
              </p>

              {selectedDate && selectedTime && (
                <button
                  type="button"
                  onClick={handleDownloadICS}
                  className="font-body inline-flex items-center gap-2 text-sm font-medium text-[#1B4332] border border-[#E5E2DB] hover:border-[#1B4332]/40 hover:bg-[#E8F2EC]/40 px-5 py-2.5 rounded-lg transition-colors"
                >
                  Add to calendar (.ics)
                </button>
              )}

              {confirmed && (
                <p className="font-body text-xs text-[#8A8680]">
                  Ref: {confirmed.appointmentId.slice(0, 8).toUpperCase()}
                </p>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
