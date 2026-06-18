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
import type { Barber, BarberService, Service, StaffAvailability } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeSlot = { start: string; end: string };

type PublicBarber = Pick<Barber, 'id' | 'name' | 'bio' | 'photo_url'>;

type PublicAvailability = Pick<
  StaffAvailability,
  'barber_id' | 'day_of_week' | 'is_available' | 'time_slots' | 'start_time_1' | 'end_time_1' | 'start_time_2' | 'end_time_2'
>;

type PublicService = Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price'>;

/**
 * Links a barber to a service they can perform.
 * Includes optional price/duration overrides so the booking flow can display
 * the effective price/duration when a specific barber is selected.
 */
type BarberServiceLink = Pick<
  BarberService,
  'barber_id' | 'service_id' | 'price_override' | 'duration_minutes_override'
>;

/** A booked appointment slot: local HH:MM time + which barber is assigned + duration. */
type BookedSlot = {
  time: string;
  barberId: string | null;
  /** Appointment duration in minutes. Defaults to 30 when not set. */
  duration: number;
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
  /** Active global services for this salon, ordered by name. */
  globalServices: PublicService[];
  /** Links barbers to the services they can perform (from barber_services table). */
  barberServiceAssignments: BarberServiceLink[];
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
 * Returns true if a barber is available on the given day_of_week, applying
 * the same logic as the backend's findEligibleBarbers (appointment-helpers.ts):
 *
 *  - No availability records at all → always available (no schedule configured).
 *  - Records exist for other days but NOT this day → unavailable (deliberately off).
 *  - Record exists for this day → return is_available.
 *
 * @param barberId     - UUID of the barber to check.
 * @param dow          - Day of week (0=Sun … 6=Sat).
 * @param availability - All staff availability records.
 * @returns            True if the barber is available on this day.
 */
function isBarberAvailableOnDay(
  barberId: string,
  dow: number,
  availability: PublicAvailability[],
): boolean {
  const dayRecord = availability.find(
    (a) => a.barber_id === barberId && a.day_of_week === dow
  );

  if (dayRecord !== undefined) {
    // Explicit record for this day → use its is_available flag.
    return dayRecord.is_available;
  }

  // No record for this day. Check whether the barber has ANY records at all.
  // If they do, this day is deliberately unconfigured (= unavailable).
  // If they don't, no schedule exists yet (= treat as always available).
  const hasAnyRecord = availability.some((a) => a.barber_id === barberId);
  return !hasAnyRecord;
}

/**
 * Checks whether a calendar date is selectable based on staff availability.
 * A date is available if at least one barber is available on that day_of_week.
 *
 * Matches the backend logic in findEligibleBarbers (appointment-helpers.ts):
 *  - Barber with NO records at all → available (no schedule configured).
 *  - Barber with records for other days but NOT this day → unavailable.
 *  - Barber with a record for this day → use is_available flag.
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
    return isBarberAvailableOnDay(selectedBarber.id, dow, availability);
  }

  // No preference — available if at least one barber in the provided list is available.
  const barberIdSet = new Set(barbers.map((b) => b.id));
  const relevantBarbers = barbers.filter((b) => barberIdSet.has(b.id));
  return relevantBarbers.some((b) => isBarberAvailableOnDay(b.id, dow, availability));
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
 * Computes the effective price and duration for a service given the selected barber.
 * Uses the barber-specific override if one exists; falls back to the global service defaults.
 *
 * @param service                 - The global service definition.
 * @param barberId                - UUID of the currently selected barber, or null for no-preference.
 * @param barberServiceAssignments - All barber-service assignments for this salon.
 * @returns                        Effective { price, duration } — either from override or global default.
 */
function getEffectivePriceAndDuration(
  service: PublicService,
  barberId: string | null,
  barberServiceAssignments: BarberServiceLink[],
): { price: number | null; duration: number | null } {
  if (barberId) {
    const assignment = barberServiceAssignments.find(
      (ba) => ba.barber_id === barberId && ba.service_id === service.id
    );
    if (assignment) {
      return {
        price:    assignment.price_override    ?? service.price,
        duration: assignment.duration_minutes_override ?? service.duration_minutes,
      };
    }
  }
  return { price: service.price, duration: service.duration_minutes };
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
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332]"
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
          className="p-2 rounded-lg hover:bg-[#E8F2EC]/60 transition-colors text-[#8A8680] hover:text-[#1B4332]"
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

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------

  const hasBarbers = barbers.length > 0;

  const [step, setStep] = useState<Step>(hasBarbers ? 'staff' : 'service');

  // -------------------------------------------------------------------------
  // Booking selections
  // -------------------------------------------------------------------------

  const [selectedBarber, setSelectedBarber] = useState<PublicBarber | null | 'none'>(
    !hasBarbers ? null : barbers.length === 1 ? barbers[0] : null
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
   * - Specific barber: returns global services they are assigned to (via barber_services).
   *   If no assignments exist for this barber, returns all global services (backwards compat).
   * - 'none' (no preference): returns all global services.
   * - null (no selection): returns all global services (shown before staff is chosen).
   */
  const availableServices: PublicService[] = (() => {
    if (selectedBarber === null || selectedBarber === 'none') {
      return globalServices;
    }

    // Specific barber: filter to services they are assigned to.
    const assignedServiceIds = new Set(
      barberServiceAssignments
        .filter((ba) => ba.barber_id === selectedBarber.id)
        .map((ba) => ba.service_id)
    );

    if (assignedServiceIds.size === 0) {
      // No assignments → all global services available (backwards compatible).
      return globalServices;
    }

    return globalServices.filter((svc) => assignedServiceIds.has(svc.id));
  })();

  // When "no preference" is selected and a service is chosen, restrict slot calculations
  // to only barbers who are assigned to that service via barber_services.
  // If no assignments exist for the service, all barbers are eligible (backwards compat).
  const effectiveBarbers: PublicBarber[] = (() => {
    if (selectedBarber !== 'none' || !selectedService) return barbers;

    const assignedBarberIds = new Set(
      barberServiceAssignments
        .filter((ba) => ba.service_id === selectedService.id)
        .map((ba) => ba.barber_id)
    );

    if (assignedBarberIds.size === 0) {
      // No assignments for this service → all barbers eligible.
      return barbers;
    }

    return barbers.filter((b) => assignedBarberIds.has(b.id));
  })();

  // -------------------------------------------------------------------------
  // Auto-advance: skip staff step when only one barber and no-preference is off
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step === 'staff' && barbers.length === 1) {
      setSelectedBarber(barbers[0]);
      setStep(globalServices.length > 0 ? 'service' : 'datetime');
    }
  }, [step, barbers, globalServices]);

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
    ? getSlotsForDate(selectedDate, selectedBarber, effectiveBarbers, staffAvailability, salon.opening_time, salon.closing_time)
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
   * Returns the resolved duration in minutes for the currently selected service/barber.
   * Uses barber-specific override when available, then global service duration, then 30.
   */
  const newDurationMinutes: number = (() => {
    if (!selectedService) return 30;
    const { duration } = getEffectivePriceAndDuration(
      selectedService,
      selectedBarber && selectedBarber !== 'none' ? selectedBarber.id : null,
      barberServiceAssignments,
    );
    return duration ?? 30;
  })();

  /**
   * Converts an HH:MM string to minutes since midnight.
   *
   * @param time - "HH:MM" 24-hour string.
   * @returns    Total minutes since 00:00.
   */
  function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * Returns true if an existing booked slot overlaps with a candidate slot.
   * Two time ranges [A, A+dA) and [B, B+dB) overlap when: A < B+dB AND B < A+dA.
   * Consistent with the server-side appointmentsOverlap() in appointment-helpers.ts.
   *
   * @param bookedStartMin  - Existing booking start in minutes since midnight.
   * @param bookedDuration  - Existing booking duration in minutes.
   * @param slotStartMin    - Candidate slot start in minutes since midnight.
   * @param slotDuration    - Candidate slot duration in minutes.
   * @returns               True if the two time ranges overlap.
   */
  function slotsOverlap(
    bookedStartMin: number,
    bookedDuration: number,
    slotStartMin: number,
    slotDuration: number,
  ): boolean {
    return bookedStartMin < slotStartMin + slotDuration && slotStartMin < bookedStartMin + bookedDuration;
  }

  /**
   * Determines whether a time slot should be blocked (past-time or fully booked).
   * - Today: also blocks slots at or before the current local time.
   * - Specific barber: blocked if that barber has an overlapping booking.
   * - No preference: blocked only if ALL available barbers have overlapping bookings.
   *
   * Uses duration-aware overlap, consistent with the backend's
   * double-booking check in POST /api/book/[slug]/appointments.
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

    const slotMin = timeToMinutes(slot);

    if (selectedBarber && selectedBarber !== 'none') {
      // Specific barber: blocked if that barber has an overlapping booking.
      return bookedSlots.some(
        (bs) =>
          bs.barberId === selectedBarber.id &&
          slotsOverlap(timeToMinutes(bs.time), bs.duration, slotMin, newDurationMinutes)
      );
    }

    // No preference: blocked only if ALL barbers who offer this service and work this slot are booked.
    if (selectedDate) {
      const workingBarbers = getAvailableBarbersForSlot(
        slot, selectedDate, effectiveBarbers, staffAvailability, salon.opening_time, salon.closing_time
      );
      if (workingBarbers.length === 0) return false;
      const bookedBarberIds = new Set(
        bookedSlots
          .filter((bs) => slotsOverlap(timeToMinutes(bs.time), bs.duration, slotMin, newDurationMinutes))
          .map((bs) => bs.barberId)
      );
      return workingBarbers.every((b) => bookedBarberIds.has(b.id));
    }

    return false;
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
      timeStr, dateStr, effectiveBarbers, staffAvailability, salon.opening_time, salon.closing_time
    );
    // Exclude barbers who have an overlapping booking (duration-aware).
    const slotMin = timeToMinutes(timeStr);
    const bookedAtTime = new Set(
      bookedSlots
        .filter((bs) => slotsOverlap(timeToMinutes(bs.time), bs.duration, slotMin, newDurationMinutes))
        .map((bs) => bs.barberId)
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
      setDetailsError('Your phone number is required.');
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

  /**
   * Selects a barber and advances to the next step.
   * If global services exist, go to service step; otherwise skip to datetime.
   *
   * @param barber - The selected barber, or 'none' for no preference.
   */
  function handleSelectBarber(barber: PublicBarber | 'none') {
    setSelectedBarber(barber);
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep(globalServices.length > 0 ? 'service' : 'datetime');
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
                    {selectedService.duration_minutes && (
                      <span className="font-body text-white/40 text-[11px]">
                        {selectedService.duration_minutes} min
                      </span>
                    )}
                    {(() => {
                      const eff = getEffectivePriceAndDuration(selectedService, selectedBarber && selectedBarber !== 'none' ? selectedBarber.id : null, barberServiceAssignments);
                      return eff.price != null ? (
                        <span className="font-body text-white/60 text-[11px] font-medium">
                          {currencySymbol}{eff.price.toFixed(2)}
                        </span>
                      ) : null;
                    })()}
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
          {step === 'staff' && hasBarbers && (
            <div className="bg-white rounded-2xl border border-[#E5E2DB] overflow-hidden shadow-sm">
              <div className="px-6 pt-6 pb-5 border-b border-[#E5E2DB]/40">
                <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">
                  Select a staff member
                </h2>
                <p className="font-body text-sm text-[#8A8680] mt-1">Choose who you'd like to see</p>
              </div>

              <div className="divide-y divide-[#E5E2DB]/60">
                {barbers.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelectBarber(b)}
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
                        // Compute effective price/duration: use barber override when a specific barber is selected.
                        const specificBarberId =
                          selectedBarber && selectedBarber !== 'none' ? selectedBarber.id : null;
                        const effective = getEffectivePriceAndDuration(
                          svc,
                          specificBarberId,
                          barberServiceAssignments,
                        );
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            onClick={() => { setSelectedService(svc); setStep('datetime'); }}
                            className="text-left p-5 rounded-xl border border-[#E5E2DB] hover:border-[#1B4332]/50 hover:bg-[#E8F2EC]/20 hover:shadow-sm transition-all group"
                          >
                            <p className="font-body text-sm font-semibold text-[#1A1A1A] leading-snug mb-3">
                              {svc.name}
                            </p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {effective.duration && (
                                  <span className="font-body text-[11px] bg-[#F5F3EF] text-[#4A4540] px-2.5 py-1 rounded-full font-medium">
                                    {effective.duration} min
                                  </span>
                                )}
                              </div>
                              {effective.price != null && (
                                <span className="font-body text-sm font-semibold text-[#1B4332]">
                                  {currencySymbol}{effective.price.toFixed(2)}
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

              {hasBarbers && (
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
                <CalendarPicker
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  timezone={salon.timezone}
                  checkAvailability={(dateStr) =>
                    isDateAvailable(dateStr, selectedBarber, effectiveBarbers, staffAvailability)
                  }
                />
              </div>

              {selectedDate && (
                <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 shadow-sm">
                  <h2 className="font-heading text-lg font-bold text-[#1A1A1A] mb-0.5">Available times</h2>
                  <p className="font-body text-xs text-[#8A8680] mb-5">{formatDateLong(selectedDate)}</p>

                  {loadingSlots ? (
                    <div className="flex items-center gap-2 text-[#8A8680]">
                      <div className="w-4 h-4 border-2 border-[#E5E2DB] border-t-[#1B4332] rounded-full animate-spin" />
                      <p className="font-body text-sm">Loading available times...</p>
                    </div>
                  ) : timeSlots.length === 0 ? (
                    <p className="font-body text-sm text-[#8A8680]">No times available on this day. Please choose another date.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {timeSlots.map((slot) => {
                        const blocked  = isSlotBlocked(slot);
                        const isActive = selectedTime === slot;

                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={blocked}
                            onClick={() => setSelectedTime(slot)}
                            className={[
                              'flex items-center justify-center py-3.5 px-3 rounded-xl border transition-all',
                              blocked
                                ? 'text-[#8A8680]/40 border-[#E5E2DB]/40 cursor-not-allowed line-through'
                                : isActive
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
                    if (selectedService || availableServices.length > 0) {
                      setStep('service');
                    } else if (hasBarbers) {
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
                        {selectedService.duration_minutes && (
                          <span className="text-[#8A8680] font-normal"> &middot; {selectedService.duration_minutes} min</span>
                        )}
                      </p>
                      {(() => {
                        const eff = getEffectivePriceAndDuration(selectedService, selectedBarber && selectedBarber !== 'none' ? selectedBarber.id : null, barberServiceAssignments);
                        return eff.price != null ? (
                          <span className="font-body text-sm font-semibold text-[#1B4332] shrink-0">
                            {currencySymbol}{eff.price.toFixed(2)}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {selectedBarber && selectedBarber !== 'none' && (
                    <p className="font-body text-sm text-[#8A8680]">with {selectedBarber.name}</p>
                  )}
                  {selectedDate && selectedTime && (
                    <p className="font-body text-sm text-[#1A1A1A] font-medium">
                      {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                    </p>
                  )}
                  <p className="font-body text-xs text-[#8A8680]">{customTitle ?? salon.name}</p>
                </div>
              </div>

              {/* Details form */}
              <form
                onSubmit={(e) => void handleSubmit(e)}
                noValidate
                className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5 shadow-sm"
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
                      className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <p className="font-body text-xs text-[#8A8680]">
                      Include your country code (e.g. +1, +357).
                    </p>
                  </div>
                )}

                {/* Phone optional */}
                {!requirePhone && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-phone" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Phone number <span className="font-body text-[#8A8680] font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="client-phone"
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => { setClientPhone(e.target.value); setDetailsError(''); }}
                      placeholder="+357 99 123 456"
                      maxLength={20}
                      autoComplete="tel"
                      className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <p className="font-body text-xs text-[#8A8680]">Include your country code (e.g. +1, +357).</p>
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
                      className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <p className="font-body text-xs text-[#8A8680]">Required for email reminders.</p>
                  </div>
                )}

                {/* Email optional */}
                {!requireEmail && (
                  <div className="space-y-1.5">
                    <Label htmlFor="client-email" className="font-body text-sm font-medium text-[#1A1A1A]">
                      Email <span className="font-body text-[#8A8680] font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="client-email"
                      type="email"
                      value={clientEmail}
                      onChange={(e) => { setClientEmail(e.target.value); setDetailsError(''); }}
                      placeholder="jane@example.com"
                      autoComplete="email"
                      className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                  </div>
                )}

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
                      onClick={() => setStep('datetime')}
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
                    {(() => {
                      const eff = getEffectivePriceAndDuration(selectedService, selectedBarber && selectedBarber !== 'none' ? selectedBarber.id : null, barberServiceAssignments);
                      return eff.price != null ? (
                        <p className="font-body text-sm text-[#1A1A1A]">
                          {currencySymbol}{eff.price.toFixed(2)}
                        </p>
                      ) : null;
                    })()}
                  </div>
                )}
                {selectedBarber && selectedBarber !== 'none' && (
                  <p className="font-body text-sm text-[#8A8680]">with {selectedBarber.name}</p>
                )}
                {selectedDate && selectedTime && (
                  <p className="font-body text-sm font-medium text-[#1A1A1A]">
                    {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
                  </p>
                )}
                <p className="font-body text-sm text-[#8A8680]">{customTitle ?? salon.name}</p>
              </div>

              <p className="font-body text-xs text-[#8A8680]">
                {"You'll receive a reminder before your appointment."}
              </p>
              <p className="font-body text-[11px] text-[#8A8680] italic mt-1">
                (Demo mode: emails are delivered to the demo account only.)
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

              {confirmedId && (
                <p className="font-body text-xs text-[#8A8680]">
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
