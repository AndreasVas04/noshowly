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
 * Structure: this component holds the current step and the visitor's
 * choices, works out what can be booked from them and lays out the page
 * (desktop sidebar, mobile hero and the current step). The parts are in
 * _components/:
 *  - StaffStep, ServiceStep, DateTimeStep (calendar and time slots),
 *    DetailsStep and SuccessScreen render one step each;
 *  - BookingSidebar is the desktop sidebar: live summary and step list;
 *  - useBusyTimes loads the busy times of the picked date;
 *  - useBookingForm holds the client details and submits the booking;
 *  - selection.ts works out the bookable staff, the services, the slot
 *    candidates of a date and the duration and price labels for the staff
 *    choice; format.ts formats times, dates and the .ics file; clock.ts is
 *    the current minute; types.ts has the shared types. These plain modules
 *    have unit tests in _components/__tests__.
 *
 * Noshowly branding is completely invisible — clients see only the salon's name.
 */

'use client';

import { useState, useSyncExternalStore } from 'react';
import { getAvailableSlots, isDateWithinBookingWindow, lastBookableDate } from '@/lib/availability';
import { getCurrencySymbol } from '@/lib/currency';
import { formatTimeZoneLabel, todayInZone } from '@/lib/time';
import type {
  PublicAvailability,
  PublicBarber,
  PublicSalon,
  PublicService,
  PublicServiceAssignment,
} from '@/types';
import BookingSidebar from './_components/BookingSidebar';
import StaffStep from './_components/StaffStep';
import ServiceStep from './_components/ServiceStep';
import DateTimeStep from './_components/DateTimeStep';
import DetailsStep from './_components/DetailsStep';
import SuccessScreen from './_components/SuccessScreen';
import { useBusyTimes } from './_components/useBusyTimes';
import { useBookingForm } from './_components/useBookingForm';
import { currentMinute, noMinuteOnServer, subscribeToMinutes } from './_components/clock';
import {
  buildCandidates,
  getAvailableServices,
  getBookableBarbers,
  serviceDurationLabel,
  servicePriceLabel,
  type StaffScope,
} from './_components/selection';
import type { BookingSummary, Step } from './_components/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The visitor's staff choice: a specific person, 'any' ("Any available
 * staff"), or null before choosing and for salons without staff.
 */
type StaffChoice = PublicBarber | 'any' | null;

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

  /** Staff members who can be booked (see getBookableBarbers()). */
  const bookableBarbers = getBookableBarbers(barbers, globalServices, barberServiceAssignments);
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

  /** The chosen staff member; null for "Any available staff", before choosing and without staff. */
  const specificBarber = selectedStaff && selectedStaff !== 'any' ? selectedStaff : null;

  // -------------------------------------------------------------------------
  // Current time (client-only, so the server render never depends on it)
  // -------------------------------------------------------------------------

  /** Start of the current minute, updated every minute; null until hydrated. */
  const minute = useSyncExternalStore<number | null>(subscribeToMinutes, currentMinute, noMinuteOnServer);
  const now = minute === null ? null : new Date(minute);

  // -------------------------------------------------------------------------
  // Busy times (fetched per selected date)
  // -------------------------------------------------------------------------

  const { busy, slotsError, loadingSlots, reloadBusy } = useBusyTimes(slug, selectedDate);

  // -------------------------------------------------------------------------
  // Client details and submit
  // -------------------------------------------------------------------------

  const form = useBookingForm({
    slug,
    requirePhone,
    requireEmail,
    selectedService,
    specificBarber,
    selectedDate,
    selectedTime,
    barberServiceAssignments,
    onBooked: () => setStep('success'),
    onTimeTaken: reloadBusy,
  });
  const { confirmed } = form;

  // -------------------------------------------------------------------------
  // Derived selection data
  // -------------------------------------------------------------------------

  /** Who a booking can be made with, for the current staff choice. */
  const staffScope: StaffScope = {
    salonHasStaff,
    bookableBarberIds,
    specificBarber,
    barberServiceAssignments,
    staffAvailability,
    salonHours,
  };

  /** Services the visitor can pick (see getAvailableServices()). */
  const availableServices = getAvailableServices(staffScope, globalServices);

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
    return buildCandidates(staffScope, date, selectedService).some((c) => c.intervals.length > 0);
  }

  /** Bookable start times on the selected date. */
  const timeSlots: string[] =
    now && selectedDate && !loadingSlots && !slotsError
      ? getAvailableSlots({
          date: selectedDate,
          timeZone,
          candidates: buildCandidates(staffScope, selectedDate, selectedService),
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
    reloadBusy();
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

  /** Who the appointment is with, for the summaries. */
  const staffLabel: string | null =
    confirmed?.barberName
      ? `with ${confirmed.barberName}`
      : specificBarber
        ? `with ${specificBarber.name}`
        : selectedStaff === 'any'
          ? 'Any available staff'
          : null;

  const selectedServiceDuration = selectedService ? serviceDurationLabel(staffScope, selectedService) : null;
  const selectedServicePrice    = selectedService ? servicePriceLabel(staffScope, selectedService, currencySymbol) : null;

  /** The visitor's choices, for the sidebar, the details step and the success screen. */
  const summary: BookingSummary = {
    selectedService,
    selectedServiceDuration,
    selectedServicePrice,
    staffLabel,
    selectedDate,
    selectedTime,
  };

  const timeZoneNote = `Times are shown in ${formatTimeZoneLabel(timeZone)} time.`;

  /** Name shown to visitors: the custom title, or the salon name. */
  const businessName = customTitle ?? salon.name;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── DESKTOP SIDEBAR ────────────────────────────────────────────────── */}
      <BookingSidebar
        businessName={businessName}
        customIntro={customIntro}
        summary={summary}
        step={step}
        hasStaffChoice={hasStaffChoice}
        hasServices={globalServices.length > 0}
      />

      {/* ── MOBILE HERO ─────────────────────────────────────────────────────── */}
      <header className="lg:hidden px-6 py-8" style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}>
        <h1 className="font-heading text-2xl font-bold text-white">
          {businessName}
        </h1>
        {customIntro && (
          <p className="font-body text-sm text-white/60 leading-relaxed mt-2">
            {customIntro}
          </p>
        )}
      </header>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      <main className="flex-1 bg-[#FAFAF8] min-h-screen">
        <div className="max-w-[560px] mx-auto px-5 lg:px-8 py-10 space-y-5">

          {/* ----------------------------------------------------------------
              STEP: staff selection
          ---------------------------------------------------------------- */}
          {step === 'staff' && (
            <StaffStep
              bookableBarbers={bookableBarbers}
              offerAnyStaff={offerAnyStaff}
              onSelect={handleSelectStaff}
            />
          )}

          {/* ----------------------------------------------------------------
              STEP: service selection
          ---------------------------------------------------------------- */}
          {step === 'service' && (
            <ServiceStep
              availableServices={availableServices}
              staffScope={staffScope}
              currencySymbol={currencySymbol}
              hasStaffChoice={hasStaffChoice}
              onSelect={handleSelectService}
              onChangeStaff={() => { setSelectedService(null); setStep('staff'); }}
            />
          )}

          {/* ----------------------------------------------------------------
              STEP: date + time
          ---------------------------------------------------------------- */}
          {step === 'datetime' && (
            <DateTimeStep
              today={today}
              lastDate={lastDate}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              isDateSelectable={isDateSelectable}
              timeZoneNote={timeZoneNote}
              loadingSlots={loadingSlots}
              slotsError={slotsError}
              onRetry={reloadBusy}
              timeSlots={timeSlots}
              selectedTime={selectedTime}
              onSelectTime={setSelectedTime}
              onBack={
                globalServices.length > 0 ? () => setStep('service')
                  : hasStaffChoice ? () => setStep('staff')
                  : undefined
              }
              onContinue={() => setStep('details')}
            />
          )}

          {/* ----------------------------------------------------------------
              STEP: client details
          ---------------------------------------------------------------- */}
          {step === 'details' && (
            <DetailsStep
              summary={summary}
              timeZoneNote={timeZoneNote}
              businessName={businessName}
              requirePhone={requirePhone}
              requireEmail={requireEmail}
              form={form}
              onBack={() => setStep('datetime')}
            />
          )}

          {/* ----------------------------------------------------------------
              STEP: success
          ---------------------------------------------------------------- */}
          {step === 'success' && (
            <SuccessScreen
              summary={summary}
              timeZoneNote={timeZoneNote}
              businessName={businessName}
              salonName={salon.name}
              timeZone={timeZone}
              confirmed={confirmed}
            />
          )}

        </div>
      </main>
    </div>
  );
}
