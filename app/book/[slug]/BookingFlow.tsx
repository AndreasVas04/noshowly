/**
 * app/book/[slug]/BookingFlow.tsx
 *
 * Multi-step public booking flow. Client component — handles all interactivity
 * for the public booking page.
 *
 * Steps:
 *  0. staff    — Select a staff member (skipped when only 1 staff + no-preference off)
 *  1. service  — Select a service (from selected staff member's services)
 *  2. datetime — Pick a date (calendar), then pick a time slot
 *  3. details  — Enter name + required contact fields (controlled per booking page settings)
 *  4. success  — Booking confirmed; option to download .ics calendar file
 *
 * Steps with no choices are auto-skipped.
 *
 * Slot conflict logic:
 *  - Specific barber selected: a slot is blocked if that barber is already booked.
 *  - No preference: a slot is blocked only if ALL available barbers are booked at that time.
 *  - No-preference slots show how many barbers are still available ("2 available").
 *  - On submit with no preference, the least-busy barber is auto-assigned.
 *
 * Noshowly branding is completely invisible — clients see only the salon's name.
 */

'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Barber, StaffAvailability, StaffService } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeSlot = { start: string; end: string };

type PublicBarber = Pick<Barber, 'id' | 'name' | 'bio' | 'photo_url'> & {
  staffServices: Pick<StaffService, 'id' | 'name' | 'duration_minutes' | 'price'>[];
};

type PublicAvailability = Pick<
  StaffAvailability,
  'barber_id' | 'day_of_week' | 'is_available' | 'time_slots' | 'start_time_1' | 'end_time_1' | 'start_time_2' | 'end_time_2'
>;

type PublicService = Pick<StaffService, 'id' | 'name' | 'duration_minutes' | 'price'>;

/** A booked appointment slot: local HH:MM time + which barber is assigned. */
type BookedSlot = {
  time: string;
  barberId: string | null;
};

type Step = 'staff' | 'service' | 'datetime' | 'details' | 'success';

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
  /** Whether clients may choose "No preference" for staff. */
  allowNoPreferenceStaff: boolean;
  /** Whether clients may choose "No preference" for service. */
  allowNoPreferenceService: boolean;
  salon: {
    name: string;
    timezone: string;
    phone: string | null;
    opening_time: string | null;
    closing_time: string | null;
    /** ISO 4217 currency code for price display, e.g. 'USD', 'EUR'. */
    currency: string;
  };
  barbers: PublicBarber[];
  staffAvailability: PublicAvailability[];
};

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/** Maps ISO 4217 codes to their display symbols. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',  EUR: '€',  GBP: '£',  AUD: 'A$', CAD: 'C$',
  CHF: 'Fr', JPY: '¥',  CNY: '¥',  INR: '₹',  BRL: 'R$',
  MXN: '$',  SGD: 'S$', HKD: 'HK$',NOK: 'kr', SEK: 'kr',
  DKK: 'kr', NZD: 'NZ$',ZAR: 'R',  AED: 'د.إ',SAR: '﷼',
  QAR: '﷼',  KWD: 'KD', TRY: '₺',  PLN: 'zł', CZK: 'Kč',
  HUF: 'Ft', RON: 'lei',BGN: 'лв', ILS: '₪',  KRW: '₩',
  THB: '฿',  MYR: 'RM', IDR: 'Rp', PHP: '₱',
};

/**
 * Returns the display symbol for a currency code.
 * Falls back to the code itself if not found.
 *
 * @param code - ISO 4217 currency code, e.g. 'EUR'.
 * @returns    Symbol string, e.g. '€'.
 */
function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

// ---------------------------------------------------------------------------
// Time-slot helpers
// ---------------------------------------------------------------------------

/**
 * Generates 30-minute time slots between opening and closing times.
 *
 * @param openingTime - HH:MM start of day, e.g. "09:00".
 * @param closingTime - HH:MM end of day, e.g. "20:00".
 * @returns           Array of HH:MM slot strings.
 */
function generateTimeSlots(openingTime: string | null, closingTime: string | null): string[] {
  const [oh, om] = (openingTime ?? '09:00').split(':').map(Number);
  const [ch, cm] = (closingTime ?? '20:00').split(':').map(Number);
  const start = oh * 60 + om;
  const end   = ch * 60 + cm;
  const slots: string[] = [];
  for (let m = start; m < end; m += 30) {
    const h   = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
  }
  return slots;
}

/**
 * Returns the day-of-week (0=Sun, 1=Mon … 6=Sat) for a YYYY-MM-DD date string.
 * Uses noon UTC to avoid any off-by-one from timezone conversions.
 *
 * @param dateStr - ISO date string, e.g. "2026-04-15".
 * @returns       Day of week integer.
 */
function getDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/**
 * Returns the working time slots from a single staff availability record.
 * Prefers the JSONB time_slots array (unlimited breaks); falls back to legacy columns.
 *
 * @param record     - Staff availability record.
 * @param salonOpen  - Salon opening time HH:MM.
 * @param salonClose - Salon closing time HH:MM.
 * @returns          Sorted array of HH:MM slot strings.
 */
function getSlotsFromRecord(
  record: PublicAvailability,
  salonOpen: string | null,
  salonClose: string | null,
): string[] {
  const slots = new Set<string>();

  if (record.time_slots && record.time_slots.length > 0) {
    for (const ts of record.time_slots as TimeSlot[]) {
      for (const s of generateTimeSlots(ts.start, ts.end)) slots.add(s);
    }
  } else if (record.start_time_1 && record.end_time_1) {
    for (const s of generateTimeSlots(record.start_time_1, record.end_time_1)) slots.add(s);
    if (record.start_time_2 && record.end_time_2) {
      for (const s of generateTimeSlots(record.start_time_2, record.end_time_2)) slots.add(s);
    }
  } else {
    // No time info on record: fall back to salon hours.
    for (const s of generateTimeSlots(salonOpen, salonClose)) slots.add(s);
  }

  return [...slots].sort();
}

/**
 * Checks whether a calendar date is selectable based on staff availability.
 * A date is available if at least one barber is available on that day_of_week.
 * Dates with no availability records at all are treated as available (fallback).
 *
 * @param dateStr        - YYYY-MM-DD date.
 * @param selectedBarber - Currently selected barber, 'none' for no-preference, or null.
 * @param barbers        - All active barbers.
 * @param availability   - All staff availability records.
 * @returns              True if the date is selectable.
 */
function isDateAvailable(
  dateStr: string,
  selectedBarber: PublicBarber | 'none' | null,
  barbers: PublicBarber[],
  availability: PublicAvailability[],
): boolean {
  if (barbers.length === 0 || availability.length === 0) return true;

  const dow = getDayOfWeek(dateStr);

  if (selectedBarber && selectedBarber !== 'none') {
    const record = availability.find(
      (a) => a.barber_id === selectedBarber.id && a.day_of_week === dow
    );
    // No record for this barber on this day → treat as available.
    return record === undefined || record.is_available;
  }

  // No preference — available if at least one barber works on this day_of_week.
  // If no records exist at all, treat as available.
  const recordsForDay = availability.filter((a) => a.day_of_week === dow);
  if (recordsForDay.length === 0) return true;
  return recordsForDay.some((a) => a.is_available);
}

/**
 * Returns available barbers who have a working slot at the given time on the given date.
 * Used to compute per-slot availability counts and for "all booked" detection.
 *
 * @param slot         - HH:MM time slot.
 * @param dateStr      - YYYY-MM-DD date.
 * @param barbers      - All active barbers.
 * @param availability - All staff availability records.
 * @param salonOpen    - Salon opening time.
 * @param salonClose   - Salon closing time.
 * @returns            Barbers who have this slot scheduled on this day_of_week.
 */
function getAvailableBarbersForSlot(
  slot: string,
  dateStr: string,
  barbers: PublicBarber[],
  availability: PublicAvailability[],
  salonOpen: string | null,
  salonClose: string | null,
): PublicBarber[] {
  const dow = getDayOfWeek(dateStr);
  return barbers.filter((barber) => {
    const record = availability.find((a) => a.barber_id === barber.id && a.day_of_week === dow);
    if (!record) return false;
    if (!record.is_available) return false;
    return getSlotsFromRecord(record, salonOpen, salonClose).includes(slot);
  });
}

/**
 * Generates available time slots for a given date based on staff availability.
 * Uses all barbers' schedules for no-preference, or just the selected barber's.
 *
 * @param dateStr        - YYYY-MM-DD date.
 * @param selectedBarber - Selected barber, 'none', or null.
 * @param barbers        - All active barbers.
 * @param availability   - All staff availability records.
 * @param salonOpen      - Salon opening time.
 * @param salonClose     - Salon closing time.
 * @returns              Sorted array of HH:MM slot strings.
 */
function getSlotsForDate(
  dateStr: string,
  selectedBarber: PublicBarber | 'none' | null,
  barbers: PublicBarber[],
  availability: PublicAvailability[],
  salonOpen: string | null,
  salonClose: string | null,
): string[] {
  const dow = getDayOfWeek(dateStr);
  const allSlots = new Set<string>();

  const effectiveBarbers: PublicBarber[] =
    selectedBarber && selectedBarber !== 'none' ? [selectedBarber] : barbers;

  if (availability.length === 0 || effectiveBarbers.length === 0) {
    return generateTimeSlots(salonOpen, salonClose);
  }

  for (const barber of effectiveBarbers) {
    const record = availability.find(
      (a) => a.barber_id === barber.id && a.day_of_week === dow
    );

    if (!record) {
      // No record → use salon hours as fallback.
      for (const s of generateTimeSlots(salonOpen, salonClose)) allSlots.add(s);
    } else if (record.is_available) {
      for (const s of getSlotsFromRecord(record, salonOpen, salonClose)) allSlots.add(s);
    }
    // is_available === false: this barber contributes no slots.
  }

  return [...allSlots].sort();
}

/**
 * Converts a local date + time in the given IANA timezone to a UTC ISO string.
 * Used when submitting the booking to the API.
 *
 * @param dateStr  - YYYY-MM-DD local date.
 * @param timeStr  - HH:MM local time.
 * @param timezone - IANA timezone, e.g. "Europe/Nicosia".
 * @returns        UTC ISO 8601 string.
 */
function localToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const naiveUTC = new Date(`${dateStr}T${timeStr}:00Z`);

  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(naiveUTC);

  const p: Record<string, string> = {};
  for (const part of tzParts) if (part.type !== 'literal') p[part.type] = part.value;

  const hour = p.hour === '24' ? '00' : p.hour;
  const tzAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}Z`);
  const offsetMs = tzAsUTC.getTime() - naiveUTC.getTime();
  return new Date(naiveUTC.getTime() - offsetMs).toISOString();
}

/** Formats "14:30" → "2:30 PM". */
function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

/** Formats "2026-04-15" → "Wednesday, April 15". */
function formatDateLong(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

/** Builds initials from a name (up to 2 characters). */
function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Builds an iCalendar (.ics) file string for the booked appointment.
 *
 * @param salonName       - Name of the salon (shown in the event title).
 * @param service         - Service name.
 * @param dateStr         - YYYY-MM-DD date.
 * @param timeStr         - HH:MM local time.
 * @param timezone        - IANA timezone.
 * @param durationMinutes - Duration in minutes; defaults to 30.
 * @returns               iCalendar text content.
 */
function buildICS(
  salonName: string,
  service: string,
  dateStr: string,
  timeStr: string,
  timezone: string,
  durationMinutes: number | null,
): string {
  const utcStart = localToUTC(dateStr, timeStr, timezone);
  const dtStart  = new Date(utcStart);
  const dtEnd    = new Date(dtStart.getTime() + (durationMinutes ?? 30) * 60_000);
  const fmt      = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(dtStart)}`,
    `DTEND:${fmt(dtEnd)}`,
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
// Calendar sub-component
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/**
 * A simple month-grid calendar that allows selecting a future date.
 * Unavailable dates are greyed out and not clickable.
 *
 * @param selected           - Currently selected YYYY-MM-DD date, or null.
 * @param onSelect           - Callback when a date is clicked.
 * @param timezone           - Salon timezone for determining "today".
 * @param checkAvailability  - Optional function; false return greys out the date.
 */
function CalendarPicker({
  selected,
  onSelect,
  timezone,
  checkAvailability,
}: {
  selected: string | null;
  onSelect: (date: string) => void;
  timezone: string;
  checkAvailability?: (dateStr: string) => boolean;
}) {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(new Date());

  const today = new Date(`${todayStr}T12:00:00Z`);
  const [viewYear, setViewYear]   = useState(today.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(today.getUTCMonth());

  const daysInMonth    = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const leadingEmpty   = Array.from({ length: firstDayOfWeek });

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
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
          className="p-2 rounded-lg hover:bg-[#1A1A1A]/5 transition-colors text-[#C8C8C8] hover:text-[#1A1A1A]"
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
          className="p-2 rounded-lg hover:bg-[#1A1A1A]/5 transition-colors text-[#C8C8C8] hover:text-[#1A1A1A]"
          aria-label="Next month"
        >
          &#8594;
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] text-[#C8C8C8] font-semibold py-1 tracking-wider">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {leadingEmpty.map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day     = i + 1;
          const dateStr = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const isPast  = dateStr < todayStr;
          const isUnavailable = !isPast && checkAvailability ? !checkAvailability(dateStr) : false;
          const isDisabled = isPast || isUnavailable;
          const isToday    = dateStr === todayStr;
          const isSelected = dateStr === selected;

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(dateStr)}
              className={[
                'aspect-square flex items-center justify-center text-sm rounded-full transition-colors font-body',
                isDisabled
                  ? 'text-[#C8C8C8]/30 cursor-not-allowed'
                  : isSelected
                    ? 'bg-[#1A1A1A] text-white font-semibold'
                    : isToday
                      ? 'underline underline-offset-2 text-[#1A1A1A] font-semibold hover:bg-[#1A1A1A]/5'
                      : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/6',
              ].join(' ')}
            >
              {day}
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
  allowNoPreferenceStaff,
  allowNoPreferenceService,
  salon,
  barbers,
  staffAvailability,
}: Props) {
  const currencySymbol = getCurrencySymbol(salon.currency);

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------

  const hasBarbers = barbers.length > 0;

  const [step, setStep] = useState<Step>(hasBarbers ? 'staff' : 'service');

  // -------------------------------------------------------------------------
  // Booking selections
  // -------------------------------------------------------------------------

  const [selectedBarber, setSelectedBarber] = useState<PublicBarber | null | 'none'>(
    !hasBarbers ? null : (barbers.length === 1 && !allowNoPreferenceStaff) ? barbers[0] : null
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
  const [detailsError, setDetailsError] = useState('');

  // -------------------------------------------------------------------------
  // Booked slots (fetched per selected date, per-barber aware)
  // -------------------------------------------------------------------------

  const [bookedSlots,  setBookedSlots]  = useState<BookedSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // -------------------------------------------------------------------------
  // Submit state
  // -------------------------------------------------------------------------

  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Services derived from selected barber
  // -------------------------------------------------------------------------

  /**
   * Returns the services available for the current barber selection.
   * - Specific barber: returns their staffServices.
   * - 'none' (no preference): returns union of all barbers' services, deduped by name.
   * - null (no selection): returns empty.
   */
  const availableServices: PublicService[] = (() => {
    if (!hasBarbers || selectedBarber === null) return [];

    if (selectedBarber === 'none') {
      const seen = new Set<string>();
      const result: PublicService[] = [];
      for (const b of barbers) {
        for (const svc of b.staffServices) {
          if (!seen.has(svc.name.toLowerCase())) {
            seen.add(svc.name.toLowerCase());
            result.push(svc);
          }
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return selectedBarber.staffServices ?? [];
  })();

  // -------------------------------------------------------------------------
  // Auto-advance: skip staff step when only one barber and no-preference is off
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step === 'staff' && barbers.length === 1 && !allowNoPreferenceStaff) {
      setSelectedBarber(barbers[0]);
      setStep(barbers[0].staffServices.length > 0 ? 'service' : 'datetime');
    }
  }, [step, barbers, allowNoPreferenceStaff]);

  // -------------------------------------------------------------------------
  // Fetch booked slots when the selected date changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedDate) return;
    setSelectedTime(null);
    setLoadingSlots(true);

    fetch(`/api/book/${slug}?date=${selectedDate}`)
      .then((r) => r.json())
      .then((data: { bookedSlots?: BookedSlot[] }) => {
        setBookedSlots(data.bookedSlots ?? []);
      })
      .catch(() => setBookedSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, slug]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const timeSlots = selectedDate
    ? getSlotsForDate(selectedDate, selectedBarber, barbers, staffAvailability, salon.opening_time, salon.closing_time)
    : generateTimeSlots(salon.opening_time, salon.closing_time);

  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: salon.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const nowMinutes = (() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: salon.timezone,
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value   ?? '0');
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  })();

  /**
   * Determines whether a time slot should be blocked (past-time or fully booked).
   * - Today: also blocks slots at or before the current local time.
   * - Specific barber: blocked if that barber has a booking at this time.
   * - No preference: blocked only if ALL available barbers are booked at this time.
   *
   * @param slot - HH:MM slot string.
   * @returns    True if the slot should not be selectable.
   */
  function isSlotBlocked(slot: string): boolean {
    // Past-time guard for today.
    if (selectedDate === todayStr) {
      const [h, m] = slot.split(':').map(Number);
      if (h * 60 + m <= nowMinutes) return true;
    }

    if (selectedBarber && selectedBarber !== 'none') {
      // Specific barber: blocked if that barber is already booked at this time.
      return bookedSlots.some(
        (bs) => bs.time === slot && bs.barberId === selectedBarber.id
      );
    }

    // No preference: blocked only if ALL barbers who work this slot are booked.
    if (selectedDate) {
      const workingBarbers = getAvailableBarbersForSlot(
        slot, selectedDate, barbers, staffAvailability, salon.opening_time, salon.closing_time
      );
      if (workingBarbers.length === 0) return false;
      const bookedBarberIds = new Set(
        bookedSlots.filter((bs) => bs.time === slot).map((bs) => bs.barberId)
      );
      return workingBarbers.every((b) => bookedBarberIds.has(b.id));
    }

    return false;
  }

  /**
   * Returns the count of barbers still available (not booked) for a slot.
   * Used to show "X available" on no-preference slot pills.
   *
   * @param slot - HH:MM slot string.
   * @returns    Number of free barbers for this slot.
   */
  function getAvailableCount(slot: string): number {
    if (!selectedDate || !selectedBarber || selectedBarber !== 'none') return 0;
    const workingBarbers = getAvailableBarbersForSlot(
      slot, selectedDate, barbers, staffAvailability, salon.opening_time, salon.closing_time
    );
    const bookedBarberIds = new Set(
      bookedSlots.filter((bs) => bs.time === slot).map((bs) => bs.barberId)
    );
    return workingBarbers.filter((b) => !bookedBarberIds.has(b.id)).length;
  }

  /**
   * Finds the least-busy barber available at the given date and time.
   * Used to auto-assign a barber when the client chose "No preference".
   * Counts existing bookings in bookedSlots (for the selected date) per barber.
   *
   * @param dateStr - YYYY-MM-DD date.
   * @param timeStr - HH:MM local time.
   * @returns       UUID of the chosen barber, or null if no one is available.
   */
  function getLeastBusyBarber(dateStr: string, timeStr: string): string | null {
    const available = getAvailableBarbersForSlot(
      timeStr, dateStr, barbers, staffAvailability, salon.opening_time, salon.closing_time
    );
    // Also exclude barbers who are already booked at this exact time.
    const bookedAtTime = new Set(
      bookedSlots.filter((bs) => bs.time === timeStr).map((bs) => bs.barberId)
    );
    const free = available.filter((b) => !bookedAtTime.has(b.id));
    if (free.length === 0) return null;

    // Count total bookings on this date per free barber.
    const bookingCount: Record<string, number> = {};
    for (const b of free) bookingCount[b.id] = 0;
    for (const bs of bookedSlots) {
      if (bs.barberId && bookingCount[bs.barberId] !== undefined) {
        bookingCount[bs.barberId]++;
      }
    }

    return free.reduce((least, b) =>
      (bookingCount[b.id] ?? 0) < (bookingCount[least.id] ?? 0) ? b : least
    ).id;
  }

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
      setDetailsError('Your phone number is required to receive SMS reminders.');
      return;
    }
    if (phone && !phone.startsWith('+')) {
      setDetailsError('Phone must include country code (e.g. +357 99 123 456).');
      return;
    }
    if (requireEmail && !email) {
      setDetailsError('Your email is required to receive email reminders.');
      return;
    }
    if (!selectedDate || !selectedTime) {
      setDetailsError('Please select a date and time.');
      return;
    }

    // Determine which barber to assign when no preference was selected.
    const assignedBarberId =
      selectedBarber && selectedBarber !== 'none'
        ? selectedBarber.id
        : getLeastBusyBarber(selectedDate, selectedTime);

    setSubmitting(true);

    try {
      const res = await fetch(`/api/book/${slug}/appointments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:   selectedService?.id   ?? null,
          service_name: selectedService?.name ?? null,
          barber_id:    assignedBarberId,
          date:         selectedDate,
          time:         selectedTime,
          client_name:  name,
          client_phone: phone || null,
          client_email: email || null,
          notes:        notes || null,
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
        return;
      }

      const data = (await res.json()) as { appointmentId: string };
      setConfirmedId(data.appointmentId);
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
    if (!selectedDate || !selectedTime) return;
    const service  = selectedService?.name ?? 'Appointment';
    const duration = selectedService?.duration_minutes ?? null;
    const ics = buildICS(salon.name, service, selectedDate, selectedTime, salon.timezone, duration);
    downloadFile(ics, 'appointment.ics', 'text/calendar');
  }

  // -------------------------------------------------------------------------
  // Helper: select a barber and advance to next step
  // -------------------------------------------------------------------------

  function handleSelectBarber(barber: PublicBarber | 'none') {
    setSelectedBarber(barber);
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedTime(null);

    if (barber === 'none') {
      const anyServices = barbers.some((b) => b.staffServices.length > 0);
      setStep(anyServices ? 'service' : 'datetime');
    } else {
      setStep(barber.staffServices.length > 0 ? 'service' : 'datetime');
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isNoPreference = selectedBarber === 'none';

  // Sidebar step list — only show Staff step when there are barbers.
  const FLOW_STEPS: { id: Step; label: string }[] = [
    ...(hasBarbers ? [{ id: 'staff' as Step, label: 'Staff member' }] : []),
    { id: 'service' as Step, label: 'Service' },
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

  const currentStepLabel =
    step === 'success' ? 'Done' : (FLOW_STEPS.find((s) => s.id === step)?.label ?? '');

  // ── Sidebar content (shared between desktop sidebar and mobile summary) ──

  /** Booking summary lines for sidebar. */
  const hasSummary =
    selectedService !== null ||
    (selectedBarber !== null && selectedBarber !== 'none') ||
    selectedDate !== null ||
    selectedTime !== null;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── MOBILE TOP BAR ─────────────────────────────────────────────────── */}
      <div className="lg:hidden bg-[#1A1A1A] px-5 py-3 flex items-center justify-between sticky top-0 z-20">
        <span className="font-heading text-white text-base font-semibold truncate">
          {customTitle ?? salon.name}
        </span>
        <span className="font-body text-white/50 text-xs ml-4 shrink-0">
          {currentStepLabel}
        </span>
      </div>

      {/* ── DESKTOP SIDEBAR ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-[240px] shrink-0 bg-[#1A1A1A] sticky top-0 self-start h-screen overflow-y-auto">
        <div className="flex flex-col h-full p-7 gap-0">

          {/* Business name */}
          <h1 className="font-heading text-white text-[22px] font-bold leading-tight mt-1">
            {customTitle ?? salon.name}
          </h1>
          {customIntro && (
            <p className="mt-2 font-body text-white/40 text-[11px] leading-relaxed">
              {customIntro}
            </p>
          )}

          {/* Live booking summary */}
          {hasSummary && (
            <div className="mt-7 pt-5 border-t border-white/10 space-y-2">
              <p className="font-body text-[10px] text-white/30 uppercase tracking-widest">Your booking</p>
              {selectedService && (
                <div>
                  <p className="font-body text-white text-sm font-semibold leading-snug">
                    {selectedService.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {selectedService.duration_minutes && (
                      <span className="font-body text-white/40 text-[11px]">
                        {selectedService.duration_minutes} min
                      </span>
                    )}
                    {selectedService.price != null && (
                      <span className="font-body text-white/60 text-[11px] font-medium">
                        {currencySymbol}{selectedService.price.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {selectedBarber && selectedBarber !== 'none' && (
                <p className="font-body text-white/50 text-[11px]">with {selectedBarber.name}</p>
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
                        status === 'active'   ? 'bg-white border-2 border-[#1A1A1A]'          :
                        status === 'complete' ? 'bg-white text-[#1A1A1A] text-[10px] font-bold' :
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

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <main className="flex-1 bg-[#F4F4F5] min-h-screen">
        <div className="max-w-[540px] mx-auto px-5 lg:px-8 py-8 space-y-4">

          {/* ----------------------------------------------------------------
              STEP: staff selection
          ---------------------------------------------------------------- */}
          {step === 'staff' && hasBarbers && (
            <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 overflow-hidden">
              <div className="px-6 pt-6 pb-5 border-b border-[#C8C8C8]/20">
                <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">
                  Select a staff member
                </h2>
              </div>

              <div className="divide-y divide-[#C8C8C8]/20">
                {/* No preference option */}
                {allowNoPreferenceStaff && (
                  <button
                    type="button"
                    onClick={() => handleSelectBarber('none')}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[#F4F4F5] transition-colors text-left"
                  >
                    <div className="w-14 h-14 rounded-full bg-[#F4F4F5] border border-[#C8C8C8]/40 flex items-center justify-center shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#C8C8C8]">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <div>
                      <p className="font-body text-sm font-semibold text-[#1A1A1A]">No preference</p>
                      <p className="font-body text-xs text-[#C8C8C8] mt-0.5">Any available team member</p>
                    </div>
                    <span className="ml-auto text-[#C8C8C8] shrink-0">&#8594;</span>
                  </button>
                )}

                {barbers.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelectBarber(b)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[#F4F4F5] transition-colors text-left group"
                  >
                    {b.photo_url ? (
                      <img
                        src={b.photo_url}
                        alt={b.name}
                        className="w-14 h-14 rounded-full object-cover shrink-0 border border-[#C8C8C8]/30"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#1A1A1A]/8 flex items-center justify-center text-sm font-semibold text-[#1A1A1A] shrink-0">
                        {getInitials(b.name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold text-[#1A1A1A]">{b.name}</p>
                      {b.bio && (
                        <p className="font-body text-xs text-[#C8C8C8] mt-0.5 line-clamp-1">{b.bio}</p>
                      )}
                    </div>
                    <span className="text-[#C8C8C8] group-hover:text-[#1A1A1A] transition-colors shrink-0">&#8594;</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: service selection
          ---------------------------------------------------------------- */}
          {step === 'service' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 overflow-hidden">
                <div className="px-6 pt-6 pb-5 border-b border-[#C8C8C8]/20">
                  <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">Choose a service</h2>
                </div>

                {availableServices.length === 0 ? (
                  <div className="p-6 text-center space-y-4">
                    <p className="font-body text-sm text-[#C8C8C8]">No services listed. Please continue to pick a time.</p>
                    <Button
                      type="button"
                      onClick={() => setStep('datetime')}
                      className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white px-6 py-2.5 h-auto font-body"
                    >
                      Continue &#8594;
                    </Button>
                  </div>
                ) : (
                  <div className="p-4">
                    {allowNoPreferenceService && (
                      <button
                        type="button"
                        onClick={() => { setSelectedService(null); setStep('datetime'); }}
                        className="w-full text-left p-4 rounded-xl border border-[#C8C8C8]/40 hover:border-[#1A1A1A]/30 transition-colors mb-3"
                      >
                        <p className="font-body text-sm font-semibold text-[#1A1A1A]">No preference</p>
                        <p className="font-body text-xs text-[#C8C8C8] mt-0.5">Any available service</p>
                      </button>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {availableServices.map((svc) => (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => { setSelectedService(svc); setStep('datetime'); }}
                          className="text-left p-4 rounded-xl border border-[#C8C8C8]/40 hover:border-[#1A1A1A] hover:bg-[#1A1A1A]/2 transition-all"
                        >
                          <p className="font-body text-sm font-semibold text-[#1A1A1A] mb-2 leading-snug">
                            {svc.name}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {svc.duration_minutes && (
                              <span className="font-body text-[11px] bg-[#F4F4F5] text-[#2D2D2D] px-2 py-0.5 rounded-md font-medium">
                                {svc.duration_minutes} min
                              </span>
                            )}
                            {svc.price != null && (
                              <span className="font-body text-[11px] bg-[#1A1A1A] text-white px-2 py-0.5 rounded-md font-medium">
                                {currencySymbol}{svc.price.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {hasBarbers && (
                <button
                  type="button"
                  onClick={() => { setSelectedService(null); setStep('staff'); }}
                  className="font-body text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
                >
                  &#8592; Change team member
                </button>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: date + time
          ---------------------------------------------------------------- */}
          {step === 'datetime' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-6">
                <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A] mb-6">Pick a date</h2>
                <CalendarPicker
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  timezone={salon.timezone}
                  checkAvailability={(dateStr) =>
                    isDateAvailable(dateStr, selectedBarber, barbers, staffAvailability)
                  }
                />
              </div>

              {selectedDate && (
                <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-6">
                  <h2 className="font-body text-base font-semibold text-[#1A1A1A] mb-0.5">Available times</h2>
                  <p className="font-body text-xs text-[#C8C8C8] mb-5">{formatDateLong(selectedDate)}</p>

                  {loadingSlots ? (
                    <p className="font-body text-sm text-[#C8C8C8]">Loading available times...</p>
                  ) : timeSlots.length === 0 ? (
                    <p className="font-body text-sm text-[#C8C8C8]">No times available on this day. Please choose another date.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {timeSlots.map((slot) => {
                        const blocked    = isSlotBlocked(slot);
                        const isActive   = selectedTime === slot;
                        const availCount = isNoPreference && !blocked ? getAvailableCount(slot) : 0;

                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={blocked}
                            onClick={() => setSelectedTime(slot)}
                            className={[
                              'flex flex-col items-center justify-center py-3 px-2 rounded-xl border transition-colors',
                              blocked
                                ? 'text-[#C8C8C8]/30 border-[#C8C8C8]/15 cursor-not-allowed line-through'
                                : isActive
                                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                                  : 'border-[#C8C8C8]/40 text-[#1A1A1A] hover:border-[#1A1A1A]/40 hover:bg-[#1A1A1A]/2',
                            ].join(' ')}
                          >
                            <span className="font-body text-xs font-semibold">
                              {formatTime12h(slot)}
                            </span>
                            {isNoPreference && !blocked && availCount > 0 && (
                              <span className={`font-body text-[10px] mt-0.5 ${isActive ? 'text-white/70' : 'text-[#C8C8C8]'}`}>
                                {availCount} avail.
                              </span>
                            )}
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
                    if (selectedService || availableServices.length > 0) {
                      setStep('service');
                    } else if (hasBarbers) {
                      setStep('staff');
                    }
                  }}
                  className="font-body text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
                >
                  &#8592; Back
                </button>

                <Button
                  type="button"
                  disabled={!selectedDate || !selectedTime}
                  onClick={() => setStep('details')}
                  className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white px-6 py-2.5 h-auto disabled:opacity-40 font-body"
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
              <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-5 space-y-1.5">
                <p className="font-body text-[10px] font-semibold text-[#C8C8C8] uppercase tracking-widest mb-2">
                  Your booking
                </p>
                {selectedService && (
                  <p className="font-body text-sm font-semibold text-[#1A1A1A]">
                    {selectedService.name}
                    {selectedService.duration_minutes && (
                      <span className="text-[#C8C8C8] font-normal"> &middot; {selectedService.duration_minutes} min</span>
                    )}
                  </p>
                )}
                {selectedBarber && selectedBarber !== 'none' && (
                  <p className="font-body text-sm text-[#C8C8C8]">with {selectedBarber.name}</p>
                )}
                {selectedDate && selectedTime && (
                  <p className="font-body text-sm text-[#1A1A1A] font-medium">
                    {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                  </p>
                )}
                <p className="font-body text-sm text-[#C8C8C8]">{customTitle ?? salon.name}</p>
              </div>

              {/* Details form */}
              <form
                onSubmit={(e) => void handleSubmit(e)}
                noValidate
                className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-6 space-y-5"
              >
                <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">Your details</h2>

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
                    className="font-body border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                  />
                </div>

                {/* Phone required */}
                {requirePhone && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-phone" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Phone number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="client-phone"
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => { setClientPhone(e.target.value); setDetailsError(''); }}
                      placeholder="+357 99 123 456"
                      maxLength={20}
                      autoComplete="tel"
                      className="font-body border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <p className="font-body text-xs text-[#C8C8C8]">
                      Required for SMS reminders. Include your country code (e.g. +1, +357).
                    </p>
                  </div>
                )}

                {/* Phone optional */}
                {!requirePhone && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-phone" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Phone number <span className="font-body text-[#C8C8C8] font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="client-phone"
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => { setClientPhone(e.target.value); setDetailsError(''); }}
                      placeholder="+357 99 123 456"
                      maxLength={20}
                      autoComplete="tel"
                      className="font-body border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <p className="font-body text-xs text-[#C8C8C8]">Include your country code (e.g. +1, +357).</p>
                  </div>
                )}

                {/* Email required */}
                {requireEmail && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-email" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="client-email"
                      type="email"
                      value={clientEmail}
                      onChange={(e) => { setClientEmail(e.target.value); setDetailsError(''); }}
                      placeholder="jane@example.com"
                      autoComplete="email"
                      className="font-body border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                    <p className="font-body text-xs text-[#C8C8C8]">Required for email reminders.</p>
                  </div>
                )}

                {/* Email optional */}
                {!requireEmail && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-email" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Email <span className="font-body text-[#C8C8C8] font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="client-email"
                      type="email"
                      value={clientEmail}
                      onChange={(e) => { setClientEmail(e.target.value); setDetailsError(''); }}
                      placeholder="jane@example.com"
                      autoComplete="email"
                      className="font-body border-[#C8C8C8] focus-visible:border-[#1A1A1A] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#C8C8C8]"
                    />
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label htmlFor="client-notes" className="font-body text-sm font-medium text-[#1A1A1A]">
                    Notes <span className="font-body text-[#C8C8C8] font-normal">(optional)</span>
                  </Label>
                  <textarea
                    id="client-notes"
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    placeholder="Any special requests or information..."
                    rows={2}
                    maxLength={500}
                    className="font-body w-full rounded-lg border border-[#C8C8C8] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#C8C8C8] outline-none focus:border-[#1A1A1A] resize-none transition-colors"
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

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setStep('datetime')}
                    className="font-body text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
                  >
                    &#8592; Back
                  </button>

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white px-8 py-3 h-auto font-body text-sm font-medium"
                  >
                    {submitting ? 'Booking...' : 'Book appointment'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP: success
          ---------------------------------------------------------------- */}
          {step === 'success' && (
            <div className="bg-white rounded-2xl border border-[#C8C8C8]/40 p-8 text-center space-y-6">
              {/* Animated checkmark */}
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
                <svg
                  viewBox="0 0 48 48"
                  fill="none"
                  stroke="#16a34a"
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
                <p className="font-body text-sm text-[#C8C8C8] mt-2">
                  {customTitle ?? salon.name} will be in touch if anything changes.
                </p>
              </div>

              {/* Booking summary */}
              <div className="bg-[#F4F4F5] rounded-xl p-5 text-left space-y-2">
                {selectedService && (
                  <div className="flex items-center justify-between">
                    <p className="font-body text-sm font-semibold text-[#1A1A1A]">{selectedService.name}</p>
                    {selectedService.price != null && (
                      <p className="font-body text-sm text-[#2D2D2D]">
                        {currencySymbol}{selectedService.price.toFixed(2)}
                      </p>
                    )}
                  </div>
                )}
                {selectedBarber && selectedBarber !== 'none' && (
                  <p className="font-body text-sm text-[#C8C8C8]">with {selectedBarber.name}</p>
                )}
                {selectedDate && selectedTime && (
                  <p className="font-body text-sm font-medium text-[#1A1A1A]">
                    {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                  </p>
                )}
                <p className="font-body text-sm text-[#C8C8C8]">{customTitle ?? salon.name}</p>
              </div>

              <p className="font-body text-xs text-[#C8C8C8]">
                {"You'll receive a reminder before your appointment."}
              </p>

              {selectedDate && selectedTime && (
                <button
                  type="button"
                  onClick={handleDownloadICS}
                  className="font-body inline-flex items-center gap-2 text-sm font-medium text-[#1A1A1A] border border-[#C8C8C8]/60 hover:border-[#1A1A1A]/30 px-5 py-2.5 rounded-lg transition-colors"
                >
                  Add to calendar (.ics)
                </button>
              )}

              {confirmedId && (
                <p className="font-body text-xs text-[#C8C8C8]">
                  Ref: {confirmedId.slice(0, 8).toUpperCase()}
                </p>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
