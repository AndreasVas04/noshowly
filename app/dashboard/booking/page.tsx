/**
 * app/dashboard/booking/page.tsx
 *
 * Online Booking management page — /dashboard/booking.
 *
 * This is the centralised place for all booking-related configuration:
 *  1. Booking page — slug, description, no-preference staff toggle, live status.
 *  2. Services — global service catalogue (add/edit/delete/toggle active).
 *  3. Staff — add/remove staff members, update name/photo/bio,
 *     service assignments (barber_services), weekly availability.
 *  4. Publish — CTA to go live or take offline.
 *
 * Design: brand-dark palette, shadcn Input + Button.
 * Security: all mutations go through API routes.
 */

'use client';

import { useState, useEffect, useRef, FormEvent, ChangeEvent } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Barber, BarberService, BookingPage, Service, StaffAvailability } from '@/types';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Per-day availability state — multiple breaks model.
 * Internally converted to/from the time_slots JSONB column in the DB.
 *
 * Working model: a contiguous work window with zero or more break gaps.
 *   No breaks:   time_slots = [{ start: work_start, end: work_end }]
 *   N breaks:    time_slots interleaved — [work_start→b0.start, b0.end→b1.start, …, bN.end→work_end]
 */
type DayState = {
  is_available: boolean;
  /** Working start time, e.g. "09:00". */
  work_start: string;
  /** Working end time, e.g. "18:00". */
  work_end: string;
  /** Ordered list of break windows for this day. */
  breaks: { start: string; end: string }[];
};

/** In-memory form state for a single barber. */
type BarberFormState = {
  name: string;
  bio: string;
  /** Current photo URL (set after upload or loaded from DB). */
  photo_url: string;
  /** day_of_week (0=Sun … 6=Sat) → day availability state. */
  availability: Record<number, DayState>;
};

/** In-memory form state for adding/editing a global service. */
type ServiceEditForm = {
  name: string;
  duration: string;
  price: string;
};

/** State for the Instagram-style photo crop modal. */
type CropModalState = {
  barberId: string;
  /** Object URL created from the selected File. Must be revoked on close. */
  src: string;
  naturalW: number;
  naturalH: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Radius of the circular crop overlay in CSS pixels. */
const CIRCLE_RADIUS = 140;

/** Output canvas size (square, in pixels) for the cropped JPEG. */
const CROP_OUTPUT_SIZE = 400;

/** Currency code → display symbol map. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',  EUR: '€',  GBP: '£',  AUD: 'A$', CAD: 'C$',
  CHF: 'Fr', JPY: '¥',  CNY: '¥',  INR: '₹',  BRL: 'R$',
  MXN: '$',  SGD: 'S$', HKD: 'HK$',NOK: 'kr', SEK: 'kr',
  DKK: 'kr', NZD: 'NZ$',ZAR: 'R',  TRY: '₺',  PLN: 'zł',
  CZK: 'Kč', HUF: 'Ft', RON: 'lei',BGN: 'лв', ILS: '₪',
  KRW: '₩',  THB: '฿',  MYR: 'RM', IDR: 'Rp', PHP: '₱',
};

/**
 * Returns the display symbol for a currency code.
 * @param code - ISO 4217 currency code.
 */
function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** Days displayed in the availability grid, Mon-first order. */
const WEEK_DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
] as const;

/**
 * Default per-day availability when no DB record exists.
 * Mon–Fri available 09:00–17:00 with no break; Sat and Sun unavailable.
 *
 * @param dayOfWeek - 0=Sunday … 6=Saturday.
 * @returns         Default DayState for the given day.
 */
function makeDefaultDayState(dayOfWeek: number): DayState {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  return {
    is_available: isWeekday,
    work_start:   '09:00',
    work_end:     '17:00',
    breaks:       [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the initial BarberFormState for a barber, merging in any
 * existing staff_availability records from the database.
 *
 * Converts the DB time_slots array into the DayState breaks model:
 *   1 slot  → work_start=slot[0].start, work_end=slot[0].end, breaks=[]
 *   2+ slots → work_start=slot[0].start, work_end=slot[last].end,
 *               breaks=[{ start: slot[0].end, end: slot[1].start }]
 *              (3+ slot legacy data: treated as a single break using first gap)
 *
 * Prefers the JSONB `time_slots` column; falls back to legacy start/end_time columns.
 *
 * @param barber       - The barber row from the database.
 * @param availability - All staff_availability records (all barbers).
 * @returns            Populated BarberFormState ready for the form.
 */
function buildBarberForm(barber: Barber, availability: StaffAvailability[]): BarberFormState {
  const barberRecords = availability.filter((a) => a.barber_id === barber.id);
  const days: Record<number, DayState> = {};

  for (let dow = 0; dow <= 6; dow++) {
    const rec = barberRecords.find((a) => a.day_of_week === dow);
    if (rec) {
      // Convert DB record to DayState breaks model.
      if (rec.time_slots && rec.time_slots.length > 0) {
        // Primary: convert JSONB time_slots array to breaks model.
        const slots = rec.time_slots as Array<{ start: string; end: string }>;
        if (slots.length === 1) {
          // Single slot — no breaks.
          days[dow] = {
            is_available: rec.is_available,
            work_start:   slots[0].start,
            work_end:     slots[0].end,
            breaks:       [],
          };
        } else {
          // 2+ slots: work spans first start → last end; one break sits between slot[0] end and slot[1] start.
          // For 3+ legacy slots we just use the first gap as the break (backwards-compatible simplification).
          days[dow] = {
            is_available: rec.is_available,
            work_start:   slots[0].start,
            work_end:     slots[slots.length - 1].end,
            breaks:       [{ start: slots[0].end, end: slots[1].start }],
          };
        }
      } else if (rec.start_time_1 && rec.end_time_1) {
        // Legacy fallback: reconstruct from start/end_time columns.
        if (rec.start_time_2 && rec.end_time_2) {
          days[dow] = {
            is_available: rec.is_available,
            work_start:   rec.start_time_1,
            work_end:     rec.end_time_2,
            breaks:       [{ start: rec.end_time_1, end: rec.start_time_2 }],
          };
        } else {
          days[dow] = {
            is_available: rec.is_available,
            work_start:   rec.start_time_1,
            work_end:     rec.end_time_1,
            breaks:       [],
          };
        }
      } else if (rec.is_available) {
        // Available but no time info — apply sensible defaults.
        days[dow] = { is_available: true, work_start: '09:00', work_end: '17:00', breaks: [] };
      } else {
        days[dow] = makeDefaultDayState(dow);
      }
    } else {
      days[dow] = makeDefaultDayState(dow);
    }
  }

  return {
    name:     barber.name,
    bio:      barber.bio ?? '',
    photo_url: barber.photo_url ?? '',
    availability: days,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Large toggle switch (for booking page settings). */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-[#1B4332]' : 'bg-[#E5E2DB]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/** Small toggle switch (compact h-5 w-9 version for availability rows). */
function SmallToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-[#1B4332]' : 'bg-[#E5E2DB]/60'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** Wraps a settings section in a card with consistent styling. */
function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DB]/40 overflow-hidden">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/**
 * BookingPage manages the full Online Booking setup:
 * slug/description/no-preference toggles, per-staff services,
 * photo uploads, availability, and publish controls.
 *
 * @returns The booking management page JSX.
 */
export default function BookingPage() {
  // -------------------------------------------------------------------------
  // Global load state
  // -------------------------------------------------------------------------
  const [loadState, setLoadState] = useState<LoadState>('loading');

  // -------------------------------------------------------------------------
  // Section 1: Booking page settings
  // -------------------------------------------------------------------------
  const [bookingPage, setBookingPage] = useState<BookingPage | null>(null);
  const [bookingSlug, setBookingSlug] = useState('');
  const [bookingDescription, setBookingDescription] = useState('');
  const [customPageTitle, setCustomPageTitle] = useState('');
  const [customIntro, setCustomIntro] = useState('');
  const [requirePhone, setRequirePhone] = useState(true);
  const [requireEmail, setRequireEmail] = useState(true);
  const [requireFieldsError, setRequireFieldsError] = useState('');
  const [bookingSaveStatus, setBookingSaveStatus] = useState<SaveStatus>('idle');
  const [bookingError, setBookingError] = useState('');
  const [copied, setCopied] = useState(false);

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
  const [deletingBarberId, setDeletingBarberId] = useState<string | null>(null);
  /** Photo remove state: barberId whose photo is being removed, or null. */
  const [removingPhotoForId, setRemovingPhotoForId] = useState<string | null>(null);
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** Refs to bio textarea elements, keyed by barberId — used for auto-resize on data load. */
  const bioTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  /** Refs to the booking page description/intro textareas — used for auto-resize. */
  const customIntroRef = useRef<HTMLTextAreaElement | null>(null);
  const bookingDescRef = useRef<HTMLTextAreaElement | null>(null);

  /** Debounce timer for booking page settings auto-save. */
  const bookingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Per-barber debounce timers for profile + availability auto-save. */
  const barberDebounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /**
   * Ref that always holds the latest doSaveBookingPage closure.
   * The debounce timer reads from this ref so it always calls the freshest version
   * of the function (avoids stale-closure issues with toggled boolean state).
   */
  const doSaveBookingPageRef = useRef<() => Promise<void>>(async () => {});
  /**
   * Ref that always holds the latest handleSaveBarber closure.
   * Same pattern as doSaveBookingPageRef — prevents stale closures in debounce timers.
   */
  const handleSaveBarberRef = useRef<(id: string) => Promise<void>>(async () => {});

  // ── Crop modal ──────────────────────────────────────────────────────────────
  /** Non-null when the crop modal is open. */
  const [cropModal, setCropModal] = useState<CropModalState | null>(null);
  /** Image offset from the crop circle center (px, in rendered/screen space). */
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  /** Current zoom scale multiplier. */
  const [cropScale, setCropScale] = useState(1);
  /** True while the cropped image is being uploaded. */
  const [cropUploading, setCropUploading] = useState(false);
  /** True while the user is actively dragging the image. */
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Ref mirror of crop position/scale — kept in sync with state so the
   * non-passive wheel handler and the canvas export can read latest values
   * without stale closures.
   */
  const cropXRef = useRef(0);
  const cropYRef = useRef(0);
  const cropScaleRef = useRef(1);

  /** Active mouse/touch drag start snapshot. */
  const dragRef = useRef<{
    startMouseX: number; startMouseY: number;
    startCropX: number;  startCropY: number;
  } | null>(null);

  /** Active pinch-zoom start snapshot. */
  const pinchRef = useRef<{
    startDist: number; startScale: number;
    startCropX: number; startCropY: number;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Salon-level service assignments (barber_services table)
  // -------------------------------------------------------------------------
  /** Salon-level services (from the services table) — used for assignment checkboxes. */
  const [salonServices, setSalonServices] = useState<Service[]>([]);
  /** All barber_services assignments for this salon. */
  const [barberServiceAssignments, setBarberServiceAssignments] = useState<BarberService[]>([]);
  /** barberId currently being updated (for disabling checkboxes during save). */
  const [savingBarberServiceId, setSavingBarberServiceId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Global Services section state
  // -------------------------------------------------------------------------
  const [showAddSvcForm, setShowAddSvcForm] = useState(false);
  const [addSvcForm, setAddSvcForm] = useState<ServiceEditForm>({ name: '', duration: '', price: '' });
  const [addingSvc, setAddingSvc] = useState(false);
  const [addSvcError, setAddSvcError] = useState('');
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [svcEditForms, setSvcEditForms] = useState<Record<string, ServiceEditForm>>({});
  const [savingSvcId, setSavingSvcId] = useState<string | null>(null);
  const [deletingSvcId, setDeletingSvcId] = useState<string | null>(null);

  /** Salon currency code — fetched once on mount for price display. */
  const [salonCurrency, setSalonCurrency] = useState('USD');
  const currencySymbol = getCurrencySymbol(salonCurrency);

  // -------------------------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------------------------

  /**
   * Fetches booking page, barbers, staff services, and availability in parallel
   * on mount. Initialises form state from loaded data.
   */
  useEffect(() => {
    async function loadData() {
      try {
        const [bookingRes, barbersRes, availabilityRes, salonServicesRes, barberServicesRes, salonRes] = await Promise.all([
          fetch('/api/booking-page'),
          fetch('/api/barbers'),
          fetch('/api/staff-availability'),
          fetch('/api/services'),
          fetch('/api/barber-services'),
          fetch('/api/salon'),
        ]);

        const [bookingData, barbersData, availData, salonServicesData, barberServicesData] = await Promise.all([
          bookingRes.ok
            ? (bookingRes.json() as Promise<{ bookingPage: BookingPage | null }>)
            : Promise.resolve({ bookingPage: null }),
          barbersRes.ok
            ? (barbersRes.json() as Promise<{ barbers: Barber[] }>)
            : Promise.resolve({ barbers: [] }),
          availabilityRes.ok
            ? (availabilityRes.json() as Promise<{ availability: StaffAvailability[] }>)
            : Promise.resolve({ availability: [] }),
          salonServicesRes.ok
            ? (salonServicesRes.json() as Promise<{ services: Service[] }>)
            : Promise.resolve({ services: [] }),
          barberServicesRes.ok
            ? (barberServicesRes.json() as Promise<{ barberServices: BarberService[] }>)
            : Promise.resolve({ barberServices: [] }),
        ]);

        // Fetch salon currency for price display.
        if (salonRes.ok) {
          const salonData = (await salonRes.json()) as { salon: { currency?: string } };
          if (salonData.salon?.currency) setSalonCurrency(salonData.salon.currency);
        }

        const bp = bookingData.bookingPage;
        setBookingPage(bp);
        if (bp) {
          setBookingSlug(bp.slug);
          setBookingDescription(bp.description ?? '');
          setCustomPageTitle(bp.custom_title ?? '');
          setCustomIntro(bp.custom_intro ?? '');
          setRequirePhone(bp.require_phone ?? true);
          setRequireEmail(bp.require_email ?? true);
        }

        const loadedBarbers = barbersData.barbers ?? [];
        const loadedAvailability = availData.availability ?? [];
        // Load all services (active and inactive) so the admin can manage them.
        const loadedSalonServices = salonServicesData.services ?? [];
        const loadedBarberServices = barberServicesData.barberServices ?? [];

        setBarbers(loadedBarbers);
        setStaffAvailability(loadedAvailability);
        setSalonServices(loadedSalonServices);
        setBarberServiceAssignments(loadedBarberServices);

        // Initialise per-barber form state from DB data.
        const forms: Record<string, BarberFormState> = {};
        for (const barber of loadedBarbers) {
          forms[barber.id] = buildBarberForm(barber, loadedAvailability);
        }
        setBarberForms(forms);

        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    }

    void loadData();
  }, []);

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
   * Auto-resizes the booking page description and intro textareas whenever
   * their content changes (e.g. initial data load or user edits).
   */
  useEffect(() => {
    for (const el of [customIntroRef.current, bookingDescRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [customIntro, bookingDescription]);

  // -------------------------------------------------------------------------
  // Section 1 handlers: Booking page settings
  // -------------------------------------------------------------------------

  /**
   * Creates or updates the booking page via POST or PUT /api/booking-page.
   *
   * @param e - Form submit event.
   */
  async function handleBookingSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBookingError('');
    setRequireFieldsError('');

    const slug = bookingSlug.trim().toLowerCase();
    if (!slug) { setBookingError('URL slug is required.'); return; }
    if (slug.length < 3 || slug.length > 50) { setBookingError('Slug must be between 3 and 50 characters.'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { setBookingError('Slug may only contain lowercase letters, digits, and hyphens.'); return; }
    if (!requirePhone && !requireEmail) {
      setRequireFieldsError('At least one contact field (phone or email) must be required.');
      return;
    }

    setBookingSaveStatus('saving');

    try {
      const method = bookingPage ? 'PUT' : 'POST';
      const res = await fetch('/api/booking-page', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          description: bookingDescription.trim() || null,
          custom_title: customPageTitle.trim() || null,
          custom_intro: customIntro.trim() || null,
          require_phone: requirePhone,
          require_email: requireEmail,
          ...(bookingPage ? {} : { is_active: false }),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBookingError(data.error ?? 'Failed to save. Please try again.');
        setBookingSaveStatus('error');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      setBookingPage(data.bookingPage);
      setBookingSlug(data.bookingPage.slug);
      setBookingDescription(data.bookingPage.description ?? '');
      setCustomPageTitle(data.bookingPage.custom_title ?? '');
      setCustomIntro(data.bookingPage.custom_intro ?? '');
      setRequirePhone(data.bookingPage.require_phone ?? true);
      setRequireEmail(data.bookingPage.require_email ?? true);
      setBookingSaveStatus('saved');
      setTimeout(() => setBookingSaveStatus('idle'), 2000);
    } catch {
      setBookingError('Something went wrong. Please check your connection and try again.');
      setBookingSaveStatus('error');
    }
  }

  /**
   * Toggles the booking page's is_active flag via PUT /api/booking-page.
   *
   * @param active - New desired active state.
   */
  async function handleBookingToggle(active: boolean): Promise<void> {
    if (!bookingPage) return;

    try {
      const res = await fetch('/api/booking-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to update. Please try again.');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      setBookingPage(data.bookingPage);
    } catch {
      alert('Something went wrong. Please check your connection and try again.');
    }
  }

  /** Copies the booking page URL to the clipboard. */
  async function handleCopyLink(): Promise<void> {
    if (!bookingPage) return;
    const url = `${window.location.origin}/book/${bookingPage.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(`Your booking link: ${url}`);
    }
  }

  // -------------------------------------------------------------------------
  // Auto-save helpers
  // -------------------------------------------------------------------------

  /**
   * Saves booking page settings via PUT /api/booking-page.
   * Called by the debounce timer — only runs when a booking page already exists.
   * Does not take a form event; reads state directly from closure.
   */
  async function doSaveBookingPage(): Promise<void> {
    if (!bookingPage) return;
    setBookingError('');
    setRequireFieldsError('');

    // Validate that at least one contact method is required.
    if (!requirePhone && !requireEmail) {
      setRequireFieldsError('At least one contact field (phone or email) must be required.');
      return;
    }

    setBookingSaveStatus('saving');

    try {
      const res = await fetch('/api/booking-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:                bookingDescription.trim() || null,
          custom_title:               customPageTitle.trim() || null,
          custom_intro:               customIntro.trim() || null,
          require_phone:              requirePhone,
          require_email:              requireEmail,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBookingError(data.error ?? 'Failed to save. Please try again.');
        setBookingSaveStatus('error');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      setBookingPage(data.bookingPage);
      setBookingDescription(data.bookingPage.description ?? '');
      setCustomPageTitle(data.bookingPage.custom_title ?? '');
      setCustomIntro(data.bookingPage.custom_intro ?? '');
      setRequirePhone(data.bookingPage.require_phone ?? true);
      setRequireEmail(data.bookingPage.require_email ?? true);
      setBookingSaveStatus('saved');
      setTimeout(() => setBookingSaveStatus('idle'), 2000);
    } catch {
      setBookingError('Something went wrong. Please check your connection and try again.');
      setBookingSaveStatus('error');
    }
  }

  /**
   * Schedules an auto-save of booking page settings after 800 ms of inactivity.
   * Clears any previously pending save before scheduling a new one.
   * Uses doSaveBookingPageRef to avoid stale-closure issues.
   */
  function scheduleBookingSave(): void {
    if (bookingDebounceRef.current) clearTimeout(bookingDebounceRef.current);
    bookingDebounceRef.current = setTimeout(() => {
      void doSaveBookingPageRef.current();
    }, 800);
  }

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
      void handleSaveBarberRef.current(barberId);
    }, 800);
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
   * Copies the entire breaks array from the source day to all other available days.
   * Only copies if the source day has at least one break.
   *
   * @param barberId  - UUID of the barber.
   * @param sourceDow - Day of week to copy breaks from.
   */
  function copyBreakToAllDays(barberId: string, sourceDow: number): void {
    let changed = false;
    setBarberForms((prev) => {
      const form = prev[barberId];
      if (!form) return prev;
      const sourceDay = form.availability[sourceDow];
      // Only proceed if the source day actually has at least one break.
      if (!sourceDay || sourceDay.breaks.length === 0) return prev;

      // Check if all working days already have identical breaks — skip if so.
      const srcBreaks = sourceDay.breaks;
      const allMatch = Object.entries(form.availability).every(([, day]) => {
        if (!day || !day.is_available) return true;
        if (day.breaks.length !== srcBreaks.length) return false;
        return day.breaks.every((b, i) => b.start === srcBreaks[i].start && b.end === srcBreaks[i].end);
      });
      if (allMatch) return prev;

      changed = true;
      // Deep copy the breaks array to avoid shared references across days.
      const breaksCopy = srcBreaks.map((brk) => ({ ...brk }));
      const newAvailability = { ...form.availability };
      for (let dow = 0; dow <= 6; dow++) {
        const day = form.availability[dow];
        if (!day || !day.is_available) continue;
        newAvailability[dow] = { ...day, breaks: breaksCopy };
      }
      return {
        ...prev,
        [barberId]: { ...form, availability: newAvailability },
      };
    });
    if (changed) scheduleBarberSave(barberId);
  }

  /**
   * Handles photo file selection — loads the file into the crop modal instead
   * of uploading directly. The actual upload happens in handleCropApply.
   *
   * @param barberId - UUID of the barber whose photo is being uploaded.
   * @param e        - File input change event.
   */
  async function handlePhotoUpload(barberId: string, e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;

    // Always reset the input immediately so the same file can be re-selected.
    const input = photoInputRefs.current[barberId];
    if (input) input.value = '';

    // Create an object URL and load the image to obtain natural dimensions.
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
      });

      const nW = img.naturalWidth;
      const nH = img.naturalHeight;
      // Initial scale: smallest value that makes the image fully cover the circle.
      const minS = Math.max((CIRCLE_RADIUS * 2) / nW, (CIRCLE_RADIUS * 2) / nH);

      // Sync refs before opening modal so wheel/canvas handlers read fresh values.
      cropXRef.current = 0;
      cropYRef.current = 0;
      cropScaleRef.current = minS;

      setCropX(0);
      setCropY(0);
      setCropScale(minS);
      setCropModal({ barberId, src, naturalW: nW, naturalH: nH });
    } catch {
      URL.revokeObjectURL(src);
      alert('Could not load the selected image. Please try another file.');
    }
  }

  /**
   * Removes the photo for a staff member via PUT /api/barbers/[id] with photo_url: null.
   * Updates the avatar in the form state immediately on success.
   *
   * @param barberId - UUID of the barber whose photo should be removed.
   */
  async function handleRemovePhoto(barberId: string): Promise<void> {
    setRemovingPhotoForId(barberId);
    try {
      const res = await fetch(`/api/barbers/${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: null }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove photo. Please try again.');
        return;
      }

      // Clear photo from form state so the avatar reverts to initials immediately.
      updateBarberField(barberId, 'photo_url', '');
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setRemovingPhotoForId(null);
    }
  }

  // ── Crop modal helpers ─────────────────────────────────────────────────────

  /**
   * Returns the minimum crop scale at which the image fully covers the circle.
   * Both axes must cover CIRCLE_RADIUS * 2.
   */
  function getCropMinScale(nW: number, nH: number): number {
    return Math.max((CIRCLE_RADIUS * 2) / nW, (CIRCLE_RADIUS * 2) / nH);
  }

  /**
   * Clamps (x, y) so the rendered image always fully covers the crop circle.
   * The image must not expose background outside its edges inside the circle.
   */
  function clampCropPos(x: number, y: number, scale: number, nW: number, nH: number) {
    const maxX = Math.max(0, (nW * scale) / 2 - CIRCLE_RADIUS);
    const maxY = Math.max(0, (nH * scale) / 2 - CIRCLE_RADIUS);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  /** Mouse down on the image — begin drag. */
  function handleCropMouseDown(e: React.MouseEvent): void {
    e.preventDefault();
    dragRef.current = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startCropX: cropXRef.current, startCropY: cropYRef.current,
    };
    setIsDragging(true);
  }

  /** Mouse move on the modal backdrop — update drag position. */
  function handleCropMouseMove(e: React.MouseEvent): void {
    if (!dragRef.current || !cropModal) return;
    const dx = e.clientX - dragRef.current.startMouseX;
    const dy = e.clientY - dragRef.current.startMouseY;
    const clamped = clampCropPos(
      dragRef.current.startCropX + dx,
      dragRef.current.startCropY + dy,
      cropScaleRef.current,
      cropModal.naturalW,
      cropModal.naturalH,
    );
    cropXRef.current = clamped.x;
    cropYRef.current = clamped.y;
    setCropX(clamped.x);
    setCropY(clamped.y);
  }

  /** Mouse up / leave — end drag. */
  function handleCropMouseUp(): void {
    dragRef.current = null;
    setIsDragging(false);
  }

  /** Returns Euclidean distance between two touch points. */
  function getTouchDist(touches: React.TouchList): number {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  /** Touch start — begin single-finger drag or two-finger pinch. */
  function handleCropTouchStart(e: React.TouchEvent): void {
    e.preventDefault();
    if (e.touches.length === 1) {
      dragRef.current = {
        startMouseX: e.touches[0].clientX, startMouseY: e.touches[0].clientY,
        startCropX: cropXRef.current, startCropY: cropYRef.current,
      };
      setIsDragging(true);
    } else if (e.touches.length === 2) {
      // Switch from drag to pinch.
      dragRef.current = null;
      setIsDragging(false);
      pinchRef.current = {
        startDist: getTouchDist(e.touches),
        startScale: cropScaleRef.current,
        startCropX: cropXRef.current,
        startCropY: cropYRef.current,
      };
    }
  }

  /** Touch move — update drag or pinch. */
  function handleCropTouchMove(e: React.TouchEvent): void {
    e.preventDefault();
    if (!cropModal) return;
    const { naturalW, naturalH } = cropModal;

    if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startMouseX;
      const dy = e.touches[0].clientY - dragRef.current.startMouseY;
      const clamped = clampCropPos(
        dragRef.current.startCropX + dx,
        dragRef.current.startCropY + dy,
        cropScaleRef.current,
        naturalW,
        naturalH,
      );
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropX(clamped.x);
      setCropY(clamped.y);
    } else if (e.touches.length === 2 && pinchRef.current) {
      const { startDist, startScale, startCropX, startCropY } = pinchRef.current;
      const minS = getCropMinScale(naturalW, naturalH);
      const newScale = Math.max(minS, Math.min(4, startScale * (getTouchDist(e.touches) / startDist)));
      const clamped = clampCropPos(startCropX, startCropY, newScale, naturalW, naturalH);
      cropScaleRef.current = newScale;
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropScale(newScale);
      setCropX(clamped.x);
      setCropY(clamped.y);
    }
  }

  /** Touch end — stop drag / pinch. */
  function handleCropTouchEnd(): void {
    dragRef.current = null;
    pinchRef.current = null;
    setIsDragging(false);
  }

  /** Cancel: revoke the object URL and close the modal. */
  function handleCropCancel(): void {
    if (cropModal) URL.revokeObjectURL(cropModal.src);
    setCropModal(null);
    setIsDragging(false);
    dragRef.current = null;
    pinchRef.current = null;
  }

  /**
   * Apply: uses Canvas API to crop the image to the visible circle area,
   * converts to JPEG blob (quality 0.9), and uploads via POST /api/upload/staff-photo.
   * Uses ref values for position/scale to guarantee latest values at call time.
   */
  async function handleCropApply(): Promise<void> {
    if (!cropModal) return;
    setCropUploading(true);

    try {
      const { src, naturalW, naturalH, barberId } = cropModal;

      // Create output canvas and clip to circle.
      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUTPUT_SIZE;
      canvas.height = CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.beginPath();
      ctx.arc(CROP_OUTPUT_SIZE / 2, CROP_OUTPUT_SIZE / 2, CROP_OUTPUT_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();

      // Load the source image (same object URL — already decoded in browser).
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image re-load failed'));
        img.src = src;
      });

      // Compute which rectangle in original image pixels the circle shows.
      // The circle center sits at viewport center = (0, 0) in our coord system.
      // Image center is offset by (cropX, cropY) from viewport center.
      // In original image pixels: circle center is at
      //   (naturalW/2 - posX/scale,  naturalH/2 - posY/scale)
      // and circle radius is CIRCLE_RADIUS/scale original pixels.
      const scale = cropScaleRef.current;
      const posX  = cropXRef.current;
      const posY  = cropYRef.current;
      const srcRadius  = CIRCLE_RADIUS / scale;
      const srcCenterX = naturalW / 2 - posX / scale;
      const srcCenterY = naturalH / 2 - posY / scale;

      ctx.drawImage(
        img,
        srcCenterX - srcRadius, srcCenterY - srcRadius, // source x, y
        srcRadius * 2,          srcRadius * 2,           // source w, h
        0, 0,                                            // dest x, y
        CROP_OUTPUT_SIZE,       CROP_OUTPUT_SIZE,        // dest w, h
      );

      // Export as JPEG blob at 90 % quality.
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
          'image/jpeg',
          0.9,
        );
      });

      // Upload.
      const formData = new FormData();
      formData.append('file', blob, 'photo.jpg');

      const res = await fetch('/api/upload/staff-photo', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to upload photo. Please try again.');
        return;
      }

      const { url } = (await res.json()) as { url: string };

      // Persist the new photo_url to the database immediately via PUT /api/barbers/[id].
      // This is done here directly rather than via the debounce scheduler because
      // photo_url changes come from a discrete action (crop + upload), not continuous
      // text edits. The debounce scheduler skips photo_url for this reason.
      const saveRes = await fetch(`/api/barbers/${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: url }),
      });

      console.log('[handleCropApply] PUT /api/barbers/%s — status: %d', barberId, saveRes.status);

      if (!saveRes.ok) {
        const errData = (await saveRes.json()) as { error?: string };
        alert(errData.error ?? 'Photo uploaded but failed to save. Please try again.');
        return;
      }

      // Update local state only after DB confirm — keeps UI in sync with reality.
      updateBarberField(barberId, 'photo_url', url);
      URL.revokeObjectURL(src);
      setCropModal(null);
    } catch (err) {
      console.error('[CropModal] handleCropApply error:', err);
      alert('Something went wrong while cropping. Please try again.');
    } finally {
      setCropUploading(false);
    }
  }

  /**
   * Non-passive wheel listener — attached when the crop modal is open.
   * React's synthetic onWheel is passive and cannot call preventDefault,
   * so we use a native listener here.
   */
  useEffect(() => {
    if (!cropModal) return;

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const { naturalW, naturalH } = cropModal!;
      const minS = Math.max((CIRCLE_RADIUS * 2) / naturalW, (CIRCLE_RADIUS * 2) / naturalH);
      // Scroll down = zoom out, scroll up = zoom in, ~8 % per tick.
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.max(minS, Math.min(4, cropScaleRef.current * factor));
      const clamped = {
        x: Math.max(
          -(Math.max(0, (naturalW * newScale) / 2 - CIRCLE_RADIUS)),
          Math.min(Math.max(0, (naturalW * newScale) / 2 - CIRCLE_RADIUS), cropXRef.current),
        ),
        y: Math.max(
          -(Math.max(0, (naturalH * newScale) / 2 - CIRCLE_RADIUS)),
          Math.min(Math.max(0, (naturalH * newScale) / 2 - CIRCLE_RADIUS), cropYRef.current),
        ),
      };
      cropScaleRef.current = newScale;
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropScale(newScale);
      setCropX(clamped.x);
      setCropY(clamped.y);
    }

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [cropModal]);

  // Keep refs in sync with state so handlers always read the latest values.
  useEffect(() => { cropXRef.current = cropX; },     [cropX]);
  useEffect(() => { cropYRef.current = cropY; },     [cropY]);
  useEffect(() => { cropScaleRef.current = cropScale; }, [cropScale]);

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
      // Convert DayState breaks array → time_slots for the DB.
      // No breaks:   [{ start: work_start, end: work_end }]
      // N breaks:    interleave — [work_start→b0.start, b0.end→b1.start, …, bN.end→work_end]
      const days = Object.entries(form.availability).map(([dowStr, day]) => {
        let timeSlots: { start: string; end: string }[] = [];
        if (day.is_available) {
          if (day.breaks.length === 0) {
            timeSlots = [{ start: day.work_start, end: day.work_end }];
          } else {
            // Sort breaks by start time so gaps are interleaved correctly.
            const sorted = [...day.breaks].sort((a, b) => a.start.localeCompare(b.start));
            let current = day.work_start;
            for (const brk of sorted) {
              timeSlots.push({ start: current, end: brk.start });
              current = brk.end;
            }
            timeSlots.push({ start: current, end: day.work_end });
          }
        }
        return {
          day_of_week:  parseInt(dowStr, 10),
          is_available: day.is_available,
          time_slots:   timeSlots,
        };
      });

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
        setTimeout(() => {
          setBarberSaveStatuses((prev) => ({ ...prev, [barberId]: 'idle' }));
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

  // -------------------------------------------------------------------------
  // Global Services handlers
  // -------------------------------------------------------------------------

  /**
   * Adds a new global service via POST /api/services.
   */
  async function handleAddGlobalService(): Promise<void> {
    const trimmedName = addSvcForm.name.trim();
    if (!trimmedName) { setAddSvcError('Service name is required.'); return; }
    if (trimmedName.length > 50) { setAddSvcError('Name must be 50 characters or fewer.'); return; }

    const durationNum = addSvcForm.duration ? parseInt(addSvcForm.duration, 10) : null;
    if (addSvcForm.duration && (isNaN(durationNum!) || durationNum! <= 0)) {
      setAddSvcError('Duration must be a positive number of minutes.'); return;
    }
    const priceNum = addSvcForm.price ? parseFloat(addSvcForm.price) : null;
    if (addSvcForm.price && (isNaN(priceNum!) || priceNum! < 0)) {
      setAddSvcError('Price must be a non-negative number.'); return;
    }

    setAddingSvc(true);
    setAddSvcError('');

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, duration_minutes: durationNum, price: priceNum }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddSvcError(data.error ?? 'Failed to add service. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) => [...prev, service].sort((a, b) => a.name.localeCompare(b.name)));
      setAddSvcForm({ name: '', duration: '', price: '' });
      setShowAddSvcForm(false);
    } catch {
      setAddSvcError('Something went wrong. Please try again.');
    } finally {
      setAddingSvc(false);
    }
  }

  /**
   * Saves inline edits for a global service via PUT /api/services/[id].
   *
   * @param serviceId - UUID of the service being edited.
   */
  async function handleSaveGlobalServiceEdit(serviceId: string): Promise<void> {
    const form = svcEditForms[serviceId];
    if (!form) return;

    const trimmedName = form.name.trim();
    if (!trimmedName) { alert('Service name is required.'); return; }
    if (trimmedName.length > 50) { alert('Name must be 50 characters or fewer.'); return; }

    const durationNum = form.duration ? parseInt(form.duration, 10) : null;
    if (form.duration && (isNaN(durationNum!) || durationNum! <= 0)) {
      alert('Duration must be a positive number of minutes.'); return;
    }
    const priceNum = form.price ? parseFloat(form.price) : null;
    if (form.price && (isNaN(priceNum!) || priceNum! < 0)) {
      alert('Price must be a non-negative number.'); return;
    }

    setSavingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, duration_minutes: durationNum, price: priceNum }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to save. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) =>
        prev.map((s) => (s.id === serviceId ? service : s)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingSvcId(null);
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setSavingSvcId(null);
    }
  }

  /**
   * Toggles the active flag on a global service via PUT /api/services/[id].
   *
   * @param serviceId - UUID of the service.
   * @param active    - New active state.
   */
  async function handleToggleGlobalService(serviceId: string, active: boolean): Promise<void> {
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to update. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setSalonServices((prev) => prev.map((s) => (s.id === serviceId ? service : s)));
    } catch {
      alert('Something went wrong. Please try again.');
    }
  }

  /**
   * Deletes a global service via DELETE /api/services/[id].
   *
   * @param serviceId   - UUID of the service.
   * @param serviceName - Used in the confirmation prompt.
   */
  async function handleDeleteGlobalService(serviceId: string, serviceName: string): Promise<void> {
    if (!window.confirm(`Remove "${serviceName}"? This cannot be undone.`)) return;

    setDeletingSvcId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove. Please try again.');
        return;
      }
      setSalonServices((prev) => prev.filter((s) => s.id !== serviceId));
      // Also clean up any barber_services assignments for this service from local state.
      setBarberServiceAssignments((prev) => prev.filter((ba) => ba.service_id !== serviceId));
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setDeletingSvcId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loadState === 'loading') {
    return (
      <div className="p-8 lg:p-12 flex items-center justify-center min-h-64">
        <p className="text-sm text-[#8A8680]">Loading booking settings…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-8 lg:p-12">
        <div className="max-w-3xl bg-red-50 border border-red-100 rounded-2xl p-6">
          <p className="text-sm text-red-700 font-medium">Failed to load booking settings.</p>
          <p className="text-sm text-red-600 mt-1">
            Please refresh the page. If the problem persists, contact support.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Keep latest function versions in refs for debounce timers.
  // This prevents stale-closure bugs when boolean state (toggles) changes
  // and the timeout fires after a single-event onChange.
  // -------------------------------------------------------------------------
  doSaveBookingPageRef.current  = doSaveBookingPage;
  handleSaveBarberRef.current   = handleSaveBarber;

  // -------------------------------------------------------------------------
  // Barber service assignment handler
  // -------------------------------------------------------------------------

  /**
   * Toggles a service assignment for a barber (optimistic update + server sync).
   * Replaces the entire assignment set for the barber on each change.
   * Preserves existing price/duration overrides for retained assignments.
   *
   * @param barberId  - The barber to update.
   * @param serviceId - The salon-level service to toggle.
   * @param checked   - True to add the assignment, false to remove it.
   */
  async function handleToggleBarberService(
    barberId: string,
    serviceId: string,
    checked: boolean,
  ): Promise<void> {
    // Retained assignments: existing assignments for this barber, minus the toggled one.
    const retainedAssignments = barberServiceAssignments.filter(
      (ba) => ba.barber_id === barberId && ba.service_id !== serviceId
    );

    // Build the new assignments list with overrides preserved for retained entries.
    const newAssignments: BarberService[] = checked
      ? [
          ...retainedAssignments,
          {
            id:                       `tmp-${barberId}-${serviceId}`,
            salon_id:                 '',
            barber_id:                barberId,
            service_id:               serviceId,
            price_override:           null,
            duration_minutes_override: null,
            created_at:               '',
          },
        ]
      : retainedAssignments;

    // Optimistic update: reflect the change immediately in the UI.
    setBarberServiceAssignments((prev) => [
      ...prev.filter((ba) => ba.barber_id !== barberId),
      ...newAssignments,
    ]);

    setSavingBarberServiceId(barberId);

    try {
      const res = await fetch('/api/barber-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barber_id: barberId,
          assignments: newAssignments.map((ba) => ({
            service_id:               ba.service_id,
            price_override:           ba.price_override,
            duration_minutes_override: ba.duration_minutes_override,
          })),
        }),
      });

      if (res.ok) {
        // Sync from server response to get real IDs for newly inserted rows.
        const data = (await res.json()) as { barberServices: BarberService[] };
        setBarberServiceAssignments((prev) => [
          ...prev.filter((ba) => ba.barber_id !== barberId),
          ...data.barberServices,
        ]);
      } else {
        // On failure, reload actual state from server to undo the optimistic update.
        const assignRes = await fetch('/api/barber-services');
        if (assignRes.ok) {
          const data = (await assignRes.json()) as { barberServices: BarberService[] };
          setBarberServiceAssignments(data.barberServices);
        }
      }
    } catch (err) {
      console.error('[BookingPage] handleToggleBarberService error:', err);
    } finally {
      setSavingBarberServiceId(null);
    }
  }

  /**
   * Updates price or duration override for a barber-service assignment in local state.
   * Call handleSaveBarberServiceOverrides (onBlur) to persist to the server.
   *
   * @param barberId  - UUID of the barber.
   * @param serviceId - UUID of the service.
   * @param field     - 'price_override' or 'duration_minutes_override'.
   * @param rawValue  - Raw string from the number input (empty = null).
   */
  function updateBarberServiceOverride(
    barberId: string,
    serviceId: string,
    field: 'price_override' | 'duration_minutes_override',
    rawValue: string,
  ): void {
    const parsed = rawValue === '' ? null : parseFloat(rawValue);
    // Reject NaN; round to integer for duration, leave decimal for price.
    const value: number | null =
      parsed === null || isNaN(parsed)
        ? null
        : field === 'duration_minutes_override'
          ? Math.round(parsed)
          : parsed;

    setBarberServiceAssignments((prev) =>
      prev.map((ba) =>
        ba.barber_id === barberId && ba.service_id === serviceId
          ? { ...ba, [field]: value }
          : ba
      )
    );
  }

  /**
   * Saves all price/duration overrides for a barber's service assignments via PUT /api/barber-services.
   * Called on blur of the override number inputs — saves the full assignments list for the barber.
   *
   * @param barberId - UUID of the barber whose overrides should be saved.
   */
  async function handleSaveBarberServiceOverrides(barberId: string): Promise<void> {
    const assignments = barberServiceAssignments
      .filter((ba) => ba.barber_id === barberId)
      .map((ba) => ({
        service_id:               ba.service_id,
        price_override:           ba.price_override,
        duration_minutes_override: ba.duration_minutes_override,
      }));

    setSavingBarberServiceId(barberId);

    try {
      const res = await fetch('/api/barber-services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barber_id: barberId, assignments }),
      });

      if (res.ok) {
        // Sync returned rows to get canonical DB values.
        const data = (await res.json()) as { barberServices: BarberService[] };
        setBarberServiceAssignments((prev) => [
          ...prev.filter((ba) => ba.barber_id !== barberId),
          ...data.barberServices,
        ]);
      }
    } catch (err) {
      console.error('[BookingPage] handleSaveBarberServiceOverrides error:', err);
    } finally {
      setSavingBarberServiceId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const bookingUrl = typeof window !== 'undefined' && bookingPage
    ? `${window.location.origin}/book/${bookingPage.slug}`
    : bookingPage ? `https://noshowly.vercel.app/book/${bookingPage.slug}` : null;

  /** Whether at least one active global service exists. */
  const hasAnyService = salonServices.some((s) => s.active);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
    <div className="p-8 lg:p-12">
      <div className="max-w-3xl space-y-12">

        {/* Page heading */}
        <div>
          <h1 className="font-heading text-3xl font-semibold text-[#1A1A1A]">Online Booking</h1>
          <p className="text-sm text-[#8A8680] mt-1.5">
            Set up your public booking page, staff, and availability.
          </p>
        </div>

        {/* ==================================================================
            SECTION 1: Booking page settings
        ================================================================== */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Booking page</h2>
            {bookingPage && (
              <span className={`text-xs font-medium transition-colors ${
                bookingSaveStatus === 'saving' ? 'text-[#8A8680]' :
                bookingSaveStatus === 'saved'  ? 'text-emerald-600' : 'invisible'
              }`}>
                {bookingSaveStatus === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
          </div>
          <p className="text-sm text-[#8A8680] mb-4">
            Clients book directly at your unique link. You control when it goes live.
          </p>

          <SectionCard>
            <div className="p-6 space-y-5">

              {/* Live/Offline badge + toggle */}
              {bookingPage && (
                <div className="flex items-start gap-3 justify-between py-1">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${bookingPage.is_active ? 'bg-emerald-500' : 'bg-[#E5E2DB]'}`} />
                      <span className="text-sm font-medium text-[#1A1A1A]">
                        {bookingPage.is_active ? 'Live' : 'Offline'}
                      </span>
                    </div>
                    {bookingUrl && (
                      <p className="text-xs text-[#8A8680] font-mono truncate">{bookingUrl}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 mt-0.5">
                    {bookingPage.is_active && bookingUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleCopyLink()}
                          className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                        >
                          {copied ? 'Copied!' : 'Copy link'}
                        </button>
                        <a
                          href={bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                        >
                          Open ↗
                        </a>
                      </>
                    )}
                    <Toggle
                      checked={bookingPage.is_active}
                      onChange={(v) => void handleBookingToggle(v)}
                      label={bookingPage.is_active ? 'Take booking page offline' : 'Go live'}
                    />
                  </div>
                </div>
              )}

              {/* ---- CREATE FLOW: no booking page yet ---- */}
              {!bookingPage && (
                <form onSubmit={(e) => void handleBookingSave(e)} noValidate className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-slug" className="text-sm font-medium text-[#1A1A1A]">
                      Choose your booking URL
                    </Label>
                    <div className="flex items-center rounded-lg border border-[#E5E2DB] overflow-hidden focus-within:border-[#1B4332] transition-colors">
                      <span className="px-3 text-sm text-[#8A8680] bg-[#F5F3EF] border-r border-[#E5E2DB] h-10 flex items-center shrink-0">
                        /book/
                      </span>
                      <input
                        id="booking-slug"
                        type="text"
                        value={bookingSlug}
                        onChange={(e) => { setBookingSlug(e.target.value); if (bookingError) setBookingError(''); }}
                        placeholder="your-business-name"
                        maxLength={50}
                        disabled={bookingSaveStatus === 'saving'}
                        className="flex-1 h-10 px-3 text-sm text-[#1A1A1A] outline-none bg-white placeholder:text-[#8A8680] disabled:opacity-50"
                      />
                    </div>
                    <p className="text-xs text-[#8A8680]">Lowercase letters, digits, and hyphens only. 3–50 characters. This cannot be changed later.</p>
                  </div>

                  {bookingError && (
                    <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                      {bookingError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={bookingSaveStatus === 'saving'}
                    className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-5 py-2.5 h-auto"
                  >
                    {bookingSaveStatus === 'saving' ? 'Creating…' : 'Create booking page'}
                  </Button>
                </form>
              )}

              {/* ---- EDIT FLOW: booking page exists — auto-saved on every change ---- */}
              {bookingPage && (
                <div className="space-y-4">

                  {/* Read-only URL display */}
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-slug" className="text-sm font-medium text-[#1A1A1A]">
                      Booking page URL
                    </Label>
                    <div className="flex items-center rounded-lg border border-[#E5E2DB]/50 bg-[#F5F3EF] overflow-hidden">
                      <span className="px-3 text-sm text-[#8A8680] bg-[#F5F3EF] border-r border-[#E5E2DB] h-10 flex items-center shrink-0">
                        /book/
                      </span>
                      <input
                        id="booking-slug"
                        type="text"
                        value={bookingSlug}
                        readOnly
                        disabled
                        className="flex-1 h-10 px-3 text-sm text-[#1A1A1A] outline-none bg-transparent disabled:opacity-60 disabled:cursor-default"
                      />
                    </div>
                    <p className="text-xs text-[#8A8680]">Your booking URL is permanent and cannot be changed.</p>
                  </div>

                  {/* Headline + Description with live preview */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                    {/* Left: form fields */}
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="booking-page-title" className="text-sm font-medium text-[#1A1A1A]">
                          Headline
                        </Label>
                        <Input
                          id="booking-page-title"
                          type="text"
                          value={customPageTitle}
                          onChange={(e) => { setCustomPageTitle(e.target.value); scheduleBookingSave(); }}
                          placeholder="e.g. Book your appointment at Elena's Studio"
                          maxLength={100}
                          disabled={bookingSaveStatus === 'saving'}
                          className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                        />
                        <p className="text-xs text-[#8A8680]">The first thing clients see. Leave blank to use your business name.</p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="booking-custom-intro" className="text-sm font-medium text-[#1A1A1A]">
                          Description
                        </Label>
                        <textarea
                          id="booking-custom-intro"
                          ref={customIntroRef}
                          value={customIntro}
                          onChange={(e) => { setCustomIntro(e.target.value); scheduleBookingSave(); }}
                          onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                            const el = e.currentTarget;
                            el.style.height = 'auto';
                            el.style.height = `${el.scrollHeight}px`;
                          }}
                          placeholder="e.g. We offer haircuts, coloring and more. Book your slot online in seconds."
                          maxLength={800}
                          rows={3}
                          disabled={bookingSaveStatus === 'saving'}
                          className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
                        />
                        <p className="text-xs text-[#8A8680]">A short description shown below the headline. Leave blank to skip.</p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="booking-description" className="text-sm font-medium text-[#1A1A1A]">
                          Link preview description (optional)
                        </Label>
                        <textarea
                          id="booking-description"
                          ref={bookingDescRef}
                          value={bookingDescription}
                          onChange={(e) => { setBookingDescription(e.target.value); scheduleBookingSave(); }}
                          onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                            const el = e.currentTarget;
                            el.style.height = 'auto';
                            el.style.height = `${el.scrollHeight}px`;
                          }}
                          placeholder="e.g. Book your appointment online. We confirm within 24 hours."
                          maxLength={500}
                          rows={2}
                          disabled={bookingSaveStatus === 'saving'}
                          className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
                        />
                        <p className="text-xs text-[#8A8680]">Shown when you share your booking link on WhatsApp, Instagram or other apps.</p>
                      </div>
                    </div>

                    {/* Right: live preview — matches the real public booking page hero */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Preview</p>
                      <div
                        className="rounded-2xl px-6 py-8 flex flex-col justify-start min-h-[180px] space-y-2"
                        style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}
                      >
                        <h3 className="font-heading text-2xl font-bold text-white leading-snug">
                          {customPageTitle.trim() || (
                            <span className="text-white/30 italic">Your headline</span>
                          )}
                        </h3>
                        {customIntro.trim() ? (
                          <p className="font-body text-sm text-white/60 leading-relaxed">{customIntro.trim()}</p>
                        ) : (
                          <p className="font-body text-sm text-white/20 italic">Description will appear here</p>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Required client information */}
                  <div className="space-y-3">
                    <div className="pt-4 border-t border-[#E5E2DB]/30">
                      <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Required client information</h2>
                      <p className="text-xs text-[#8A8680] mt-0.5">Turn off fields you do not need. At least one must be required.</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-[#1A1A1A]">Require phone number</p>
                        <p className="text-xs text-[#8A8680] mt-0.5">Used for client contact.</p>
                      </div>
                      <Toggle
                        checked={requirePhone}
                        onChange={(v) => { setRequirePhone(v); setRequireFieldsError(''); scheduleBookingSave(); }}
                        label="Require phone number"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-[#1A1A1A]">Require email address</p>
                        <p className="text-xs text-[#8A8680] mt-0.5">Needed for email reminders.</p>
                      </div>
                      <Toggle
                        checked={requireEmail}
                        onChange={(v) => { setRequireEmail(v); setRequireFieldsError(''); scheduleBookingSave(); }}
                        label="Require email address"
                      />
                    </div>
                    {requireFieldsError && (
                      <p className="text-xs text-red-600">{requireFieldsError}</p>
                    )}
                  </div>

                  {bookingError && (
                    <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                      {bookingError}
                    </div>
                  )}
                </div>
              )}

            </div>
          </SectionCard>
        </section>

        {/* ==================================================================
            SECTION 2: Global Services
        ================================================================== */}
        <section>
          <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Services</h2>
          <p className="text-sm text-[#8A8680] mb-4">
            Define the services you offer. Toggle &quot;Available on booking page&quot; to control what clients can book.
          </p>

          <SectionCard>
            <div className="p-6 space-y-0">
              {salonServices.length === 0 && !showAddSvcForm && (
                <p className="text-sm text-[#8A8680] py-2">No services yet. Add your first service below.</p>
              )}

              {salonServices.length > 0 && (
                <ul className="divide-y divide-[#E5E2DB]/30 mb-4">
                  {salonServices.map((svc) => (
                    <li key={svc.id} className="py-3">
                      {editingSvcId === svc.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-1 space-y-1">
                              <Label className="text-xs text-[#8A8680]">Name</Label>
                              <Input
                                value={svcEditForms[svc.id]?.name ?? ''}
                                onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], name: e.target.value } }))}
                                maxLength={50}
                                className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-[#8A8680]">Min</Label>
                              <Input
                                type="number"
                                min={1}
                                value={svcEditForms[svc.id]?.duration ?? ''}
                                onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], duration: e.target.value } }))}
                                placeholder="30"
                                className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-[#8A8680]">Price</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                value={svcEditForms[svc.id]?.price ?? ''}
                                onChange={(e) => setSvcEditForms((prev) => ({ ...prev, [svc.id]: { ...prev[svc.id], price: e.target.value } }))}
                                placeholder="25.00"
                                className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              disabled={savingSvcId === svc.id}
                              onClick={() => void handleSaveGlobalServiceEdit(svc.id)}
                              className="bg-[#1B4332] hover:bg-[#16392A] text-white text-xs px-3 py-1.5 h-auto"
                            >
                              {savingSvcId === svc.id ? 'Saving…' : 'Save'}
                            </Button>
                            <button
                              type="button"
                              onClick={() => setEditingSvcId(null)}
                              className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`text-sm ${svc.active ? 'text-[#1A1A1A]' : 'text-[#8A8680]'}`}>{svc.name}</p>
                            {(svc.duration_minutes || svc.price != null) && (
                              <p className="text-xs text-[#8A8680] mt-0.5">
                                {[
                                  svc.duration_minutes ? `${svc.duration_minutes} min` : null,
                                  svc.price != null ? `${currencySymbol}${Number(svc.price).toFixed(2)}` : null,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none w-fit">
                              <input
                                type="checkbox"
                                checked={svc.active}
                                onChange={(e) => void handleToggleGlobalService(svc.id, e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-[#E5E2DB] accent-[#1A1A1A] cursor-pointer"
                              />
                              <span className="text-xs text-[#8A8680]">Available on booking page</span>
                            </label>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSvcId(svc.id);
                                setSvcEditForms((prev) => ({
                                  ...prev,
                                  [svc.id]: {
                                    name: svc.name,
                                    duration: svc.duration_minutes?.toString() ?? '',
                                    price: svc.price != null ? String(svc.price) : '',
                                  },
                                }));
                              }}
                              className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteGlobalService(svc.id, svc.name)}
                              disabled={deletingSvcId === svc.id}
                              className="text-xs text-[#8A8680] hover:text-red-600 disabled:opacity-40 transition-colors"
                            >
                              {deletingSvcId === svc.id ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {showAddSvcForm ? (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs text-[#8A8680]">Name *</Label>
                      <Input
                        type="text"
                        value={addSvcForm.name}
                        onChange={(e) => { setAddSvcForm((prev) => ({ ...prev, name: e.target.value })); if (addSvcError) setAddSvcError(''); }}
                        placeholder="e.g. Haircut"
                        maxLength={50}
                        disabled={addingSvc}
                        className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-[#8A8680]">Min</Label>
                      <Input
                        type="number"
                        min={1}
                        value={addSvcForm.duration}
                        onChange={(e) => setAddSvcForm((prev) => ({ ...prev, duration: e.target.value }))}
                        placeholder="30"
                        disabled={addingSvc}
                        className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-[#8A8680]">Price</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={addSvcForm.price}
                        onChange={(e) => setAddSvcForm((prev) => ({ ...prev, price: e.target.value }))}
                        placeholder="25.00"
                        disabled={addingSvc}
                        className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-xs"
                      />
                    </div>
                  </div>
                  {addSvcError && <p className="text-xs text-red-600">{addSvcError}</p>}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      disabled={addingSvc}
                      onClick={() => void handleAddGlobalService()}
                      className="bg-[#1B4332] hover:bg-[#16392A] text-white text-xs px-3 py-1.5 h-auto"
                    >
                      {addingSvc ? 'Adding…' : 'Add'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setShowAddSvcForm(false); setAddSvcError(''); }}
                      className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setShowAddSvcForm(true); setAddSvcForm({ name: '', duration: '', price: '' }); }}
                  className="text-xs font-medium text-[#1A1A1A] hover:text-[#2D2D2D] transition-colors mt-2"
                >
                  + Add service
                </button>
              )}
            </div>
          </SectionCard>
        </section>

        {/* ==================================================================
            SECTION 3: Staff
        ================================================================== */}
        <section>
          <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Staff</h2>
          <p className="text-sm text-[#8A8680] mb-4">
            Add your team members. For each person, set the services they offer and
            their working hours so clients only see available slots.
          </p>

          <div className="space-y-4">

            {barbers.length === 0 && (
              <SectionCard>
                <div className="px-6 py-10 text-center">
                  <p className="text-sm text-[#8A8680]">No staff members yet. Add your first staff member below.</p>
                </div>
              </SectionCard>
            )}

            {barbers.map((barber) => {
              const form = barberForms[barber.id];
              if (!form) return null;
              const isSaving = barberSaveStatuses[barber.id] === 'saving';
              const barberSaveStatus = barberSaveStatuses[barber.id] ?? 'idle';
              const isDeleting = deletingBarberId === barber.id;
              const isRemovingPhoto = removingPhotoForId === barber.id;
              const initials = barber.name.slice(0, 2).toUpperCase();

              return (
                <SectionCard key={barber.id}>
                  <div className="p-6 space-y-6">

                    {/* Header: name + save status + remove */}
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold text-[#1A1A1A] truncate">{barber.name}</p>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-xs font-medium transition-colors ${
                          barberSaveStatus === 'saving' ? 'text-[#8A8680]' :
                          barberSaveStatus === 'saved'  ? 'text-emerald-600' : 'invisible'
                        }`}>
                          {barberSaveStatus === 'saving' ? 'Saving…' : 'Saved'}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteBarber(barber.id, barber.name)}
                          disabled={isDeleting}
                          className="text-xs text-[#8A8680] hover:text-red-600 disabled:opacity-40 transition-colors"
                        >
                          {isDeleting ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>

                    {/* Photo upload section — clicking the circle/link opens the crop modal */}
                    <div className="flex flex-col items-start gap-2">
                      {/* Clickable 80px circle with camera overlay on hover */}
                      <button
                        type="button"
                        onClick={() => photoInputRefs.current[barber.id]?.click()}
                        disabled={isRemovingPhoto || isSaving}
                        className="group relative w-20 h-20 rounded-full overflow-hidden shrink-0 border border-[#E5E2DB]/30 bg-[#F5F3EF] flex items-center justify-center disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] focus-visible:ring-offset-2"
                        aria-label="Upload photo"
                      >
                        {/* Photo or initials */}
                        {form.photo_url ? (
                          <img
                            src={form.photo_url}
                            alt={barber.name}
                            className="w-full h-full object-cover object-center"
                          />
                        ) : (
                          <span className="text-lg font-semibold text-[#1A1A1A] select-none">
                            {initials}
                          </span>
                        )}
                        {/* Camera icon overlay — appears on hover */}
                        <span className="absolute bottom-0 right-0 w-6 h-6 bg-[#1A1A1A] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                          <Camera size={12} className="text-white" />
                        </span>
                      </button>

                      {/* Text links below circle */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => photoInputRefs.current[barber.id]?.click()}
                          disabled={isRemovingPhoto || isSaving}
                          className="text-xs text-[#1A1A1A] underline underline-offset-2 hover:text-[#2D2D2D] disabled:opacity-40 transition-colors"
                        >
                          Change photo
                        </button>
                        {form.photo_url && (
                          <>
                            <span className="text-[#8A8680] text-xs">·</span>
                            <button
                              type="button"
                              onClick={() => void handleRemovePhoto(barber.id)}
                              disabled={isRemovingPhoto || isSaving}
                              className="text-xs text-[#8A8680] hover:text-red-600 disabled:opacity-40 transition-colors"
                            >
                              {isRemovingPhoto ? 'Removing…' : 'Remove photo'}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Hidden file input */}
                      <input
                        ref={(el) => { photoInputRefs.current[barber.id] = el; }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => void handlePhotoUpload(barber.id, e)}
                      />
                    </div>

                    {/* Profile fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Name</Label>
                        <Input
                          value={form.name}
                          onChange={(e) => updateBarberField(barber.id, 'name', e.target.value)}
                          maxLength={50}
                          disabled={isSaving}
                          className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-sm text-[#1A1A1A]"
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Bio (optional)</Label>
                        <textarea
                          ref={(el) => { bioTextareaRefs.current[barber.id] = el; }}
                          value={form.bio}
                          onChange={(e) => updateBarberField(barber.id, 'bio', e.target.value)}
                          onInput={(e) => {
                            e.currentTarget.style.height = 'auto';
                            e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
                          }}
                          placeholder="Short description shown on the booking page"
                          maxLength={300}
                          rows={2}
                          disabled={isSaving}
                          className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
                        />
                      </div>
                    </div>

                    {/* Services this staff member can perform */}
                    {salonServices.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest mb-1">
                          Services this staff member can perform
                        </p>
                        <p className="text-xs text-[#8A8680] mb-3">
                          When checked, this staff member will be available for these services.
                          Optionally override the price or duration per staff member.
                        </p>
                        <div className="space-y-3">
                          {salonServices.map((svc) => {
                            const assignment = barberServiceAssignments.find(
                              (ba) => ba.barber_id === barber.id && ba.service_id === svc.id
                            );
                            const isAssigned = !!assignment;
                            const isSavingAssignments = savingBarberServiceId === barber.id;
                            return (
                              <div key={svc.id} className="space-y-2">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                                  <input
                                    type="checkbox"
                                    checked={isAssigned}
                                    disabled={isSavingAssignments}
                                    onChange={(e) =>
                                      void handleToggleBarberService(barber.id, svc.id, e.target.checked)
                                    }
                                    className="h-4 w-4 rounded border-[#E5E2DB] accent-[#1B4332] cursor-pointer disabled:opacity-50"
                                  />
                                  <span className="text-sm text-[#1A1A1A] group-hover:text-[#1B4332] transition-colors">
                                    {svc.name}
                                  </span>
                                </label>

                                {/* Override fields — shown only when this service is assigned to this barber */}
                                {isAssigned && assignment && (
                                  <div className="ml-6 mt-1.5 grid grid-cols-2 gap-2 max-w-xs">
                                    <div className="rounded-lg border border-[#E5E2DB] px-3 py-2 space-y-0.5 bg-[#FAFAF8]">
                                      <p className="text-[10px] font-medium text-[#8A8680] uppercase tracking-wider">Price</p>
                                      <div className="flex items-baseline gap-1">
                                        <span className="text-xs text-[#8A8680]">{currencySymbol}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          value={assignment.price_override ?? ''}
                                          onChange={(e) =>
                                            updateBarberServiceOverride(barber.id, svc.id, 'price_override', e.target.value)
                                          }
                                          onBlur={() => void handleSaveBarberServiceOverrides(barber.id)}
                                          placeholder={svc.price != null ? String(svc.price) : 'Same as service'}
                                          disabled={isSavingAssignments}
                                          className="w-full text-sm text-[#1A1A1A] bg-transparent outline-none placeholder:text-[#C8C8C8] disabled:opacity-50"
                                        />
                                      </div>
                                      {svc.price != null && (
                                        <p className="text-[10px] text-[#C8C8C8]">Default: {currencySymbol}{svc.price}</p>
                                      )}
                                    </div>

                                    <div className="rounded-lg border border-[#E5E2DB] px-3 py-2 space-y-0.5 bg-[#FAFAF8]">
                                      <p className="text-[10px] font-medium text-[#8A8680] uppercase tracking-wider">Duration (min)</p>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={assignment.duration_minutes_override ?? ''}
                                        onChange={(e) =>
                                          updateBarberServiceOverride(barber.id, svc.id, 'duration_minutes_override', e.target.value)
                                        }
                                        onBlur={() => void handleSaveBarberServiceOverrides(barber.id)}
                                        placeholder={svc.duration_minutes != null ? String(svc.duration_minutes) : 'Same as service'}
                                        disabled={isSavingAssignments}
                                        className="w-16 text-sm text-[#1A1A1A] bg-transparent outline-none placeholder:text-[#C8C8C8] disabled:opacity-50"
                                      />
                                      {svc.duration_minutes != null && (
                                        <p className="text-[10px] text-[#C8C8C8]">Default: {svc.duration_minutes} min</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {savingBarberServiceId === barber.id && (
                          <p className="text-xs text-[#8A8680] mt-2">Saving…</p>
                        )}
                      </div>
                    )}

                    {/* Weekly availability */}
                    <div>
                      <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest mb-3">
                        Weekly availability
                      </p>
                      <div className="space-y-2">
                        {WEEK_DAYS.map(({ label, value: dow }) => {
                          const day = form.availability[dow] ?? makeDefaultDayState(dow);
                          return (
                            <div
                              key={dow}
                              className={`rounded-xl border px-4 py-3 transition-colors ${
                                day.is_available ? 'border-[#E5E2DB]/40 bg-white' : 'border-[#E5E2DB]/20 bg-[#F9F9F9]'
                              }`}
                            >
                              <div className="flex flex-col gap-2">
                                {/* Day label + toggle — own row */}
                                <div className="flex items-center gap-2">
                                  <SmallToggle
                                    checked={day.is_available}
                                    onChange={(v) => setDayAvailable(barber.id, dow, v)}
                                    label={`${label} availability`}
                                  />
                                  <span className={`text-xs font-medium ${day.is_available ? 'text-[#1A1A1A]' : 'text-[#8A8680]'}`}>
                                    {label}
                                  </span>
                                  {!day.is_available && (
                                    <span className="text-xs text-[#8A8680] ml-1">Not available</span>
                                  )}
                                </div>

                                {day.is_available && (
                                  <div className="pl-2 space-y-2">
                                    {/* Working hours section */}
                                    <div>
                                      <p className="text-xs text-[#8A8680] font-medium mb-1">Working hours</p>
                                      <div className="flex flex-row items-center gap-1.5">
                                        <input
                                          type="time"
                                          value={day.work_start}
                                          onChange={(e) => setWorkTime(barber.id, dow, 'work_start', e.target.value)}
                                          disabled={isSaving}
                                          style={{ width: '110px' }}
                                          className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                                        />
                                        <span className="text-xs text-[#8A8680] shrink-0">to</span>
                                        <input
                                          type="time"
                                          value={day.work_end}
                                          onChange={(e) => setWorkTime(barber.id, dow, 'work_end', e.target.value)}
                                          disabled={isSaving}
                                          style={{ width: '110px' }}
                                          className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                                        />
                                      </div>
                                    </div>

                                    {/* Break section — supports multiple breaks */}
                                    <div className="space-y-2 mt-1">
                                      {day.breaks.map((brk, i) => (
                                        <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-1.5">
                                          <p className="text-xs text-amber-700 font-medium">Break {day.breaks.length > 1 ? i + 1 : ''}</p>
                                          <div className="flex flex-row items-center gap-1.5">
                                            <input
                                              type="time"
                                              value={brk.start}
                                              onChange={(e) => setBreakTime(barber.id, dow, i, 'start', e.target.value)}
                                              disabled={isSaving}
                                              style={{ width: '110px' }}
                                              className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                                            />
                                            <span className="text-xs text-[#8A8680] shrink-0">to</span>
                                            <input
                                              type="time"
                                              value={brk.end}
                                              onChange={(e) => setBreakTime(barber.id, dow, i, 'end', e.target.value)}
                                              disabled={isSaving}
                                              style={{ width: '110px' }}
                                              className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                                            />
                                          </div>
                                          <div className="flex items-center gap-3 pt-0.5">
                                            <button
                                              type="button"
                                              onClick={() => removeBreak(barber.id, dow, i)}
                                              className="text-xs text-amber-600 hover:text-amber-800 transition-colors"
                                            >
                                              × Remove break
                                            </button>
                                            {i === 0 && day.breaks.length === 1 && (
                                              <button
                                                type="button"
                                                onClick={() => copyBreakToAllDays(barber.id, dow)}
                                                className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                                              >
                                                Apply to all days
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}

                                      {/* "+ Add break" is always visible when the day is available */}
                                      <button
                                        type="button"
                                        onClick={() => addBreak(barber.id, dow)}
                                        className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                                      >
                                        + Add break
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </SectionCard>
              );
            })}

            {/* Add staff member form */}
            <SectionCard>
              <form onSubmit={(e) => void handleAddBarber(e)} noValidate className="px-6 py-5">
                <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest mb-3">
                  Add staff member
                </p>
                <div className="flex gap-3">
                  <Input
                    type="text"
                    value={addBarberName}
                    onChange={(e) => { setAddBarberName(e.target.value); if (addBarberError) setAddBarberError(''); }}
                    placeholder="First name, e.g. John"
                    maxLength={50}
                    disabled={addingBarber}
                    className="flex-1 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                  />
                  <Button
                    type="submit"
                    disabled={addingBarber}
                    className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-4 shrink-0"
                  >
                    {addingBarber ? 'Adding…' : 'Add'}
                  </Button>
                </div>
                {addBarberError && (
                  <p className="mt-2 text-sm text-red-600">{addBarberError}</p>
                )}
              </form>
            </SectionCard>

          </div>
        </section>

        {/* ==================================================================
            SECTION 3: Publish
        ================================================================== */}
        <section>
          <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Publish</h2>
          <p className="text-sm text-[#8A8680] mb-4">
            Make your booking page live so clients can start booking online.
          </p>

          <SectionCard>
            <div className="p-6 space-y-4">

              {bookingPage?.is_active ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <p className="text-sm font-medium text-[#1A1A1A]">
                      Your booking page is live
                    </p>
                  </div>
                  {bookingUrl && (
                    <p className="text-sm text-[#8A8680]">
                      Share this link with your clients:{' '}
                      <a
                        href={bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#1A1A1A] hover:underline"
                      >
                        {bookingUrl}
                      </a>
                    </p>
                  )}
                  <Button
                    type="button"
                    onClick={() => void handleBookingToggle(false)}
                    variant="outline"
                    className="border-[#E5E2DB] text-[#1A1A1A] hover:border-[#1A1A1A]/40 text-sm"
                  >
                    Take offline
                  </Button>
                </>
              ) : (
                <>
                  {!bookingPage && (
                    <p className="text-sm text-amber-600">
                      You need to save a booking page URL before you can go live.
                    </p>
                  )}
                  {!hasAnyService && (
                    <p className="text-sm text-amber-600">
                      Add at least one active service before going live.
                    </p>
                  )}

                  <Button
                    type="button"
                    disabled={!bookingPage || !hasAnyService}
                    onClick={() => void handleBookingToggle(true)}
                    className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-8 py-3 h-auto disabled:opacity-40"
                  >
                    Publish booking page
                  </Button>

                  {bookingPage && hasAnyService && (
                    <p className="text-xs text-[#8A8680]">
                      Your page will be visible at{' '}
                      <span className="font-mono">/book/{bookingPage.slug}</span>.
                      You can take it offline at any time.
                    </p>
                  )}
                </>
              )}

            </div>
          </SectionCard>
        </section>

      </div>
    </div>

    {/* ── Instagram-style crop modal ─────────────────────────────────────────
        Full-screen dark overlay. User drags / scrolls / pinches to reposition
        the image inside a fixed circular crop window. "Apply" crops via Canvas
        and uploads the result. "Cancel" discards the selection.
    ──────────────────────────────────────────────────────────────────────── */}
    {cropModal && (
      <div
        className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden"
        style={{ userSelect: 'none', touchAction: 'none' }}
        onMouseMove={handleCropMouseMove}
        onMouseUp={handleCropMouseUp}
        onMouseLeave={handleCropMouseUp}
      >
        {/* ── Image layer ─────────────────────────────────────────────────── */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropModal.src}
            alt="Crop preview"
            draggable={false}
            onMouseDown={handleCropMouseDown}
            onTouchStart={handleCropTouchStart}
            onTouchMove={handleCropTouchMove}
            onTouchEnd={handleCropTouchEnd}
            style={{
              width: cropModal.naturalW,
              height: cropModal.naturalH,
              maxWidth: 'none',
              transform: `translate(${cropX}px, ${cropY}px) scale(${cropScale})`,
              transformOrigin: 'center',
              cursor: isDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          />
        </div>

        {/* ── Circle crop overlay ──────────────────────────────────────────
            A transparent circle sits in the center; box-shadow darkens the
            area outside it (classic Instagram technique).
        ───────────────────────────────────────────────────────────────── */}
        <div
          className="absolute pointer-events-none"
          style={{
            width:  CIRCLE_RADIUS * 2,
            height: CIRCLE_RADIUS * 2,
            borderRadius: '50%',
            top:  '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
            border: '2px solid rgba(255,255,255,0.35)',
          }}
        />

        {/* ── Upload spinner — shown over everything while uploading ───────── */}
        {cropUploading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 pointer-events-none">
            <div
              className="rounded-full border-2 border-white border-t-transparent animate-spin"
              style={{ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 }}
            />
          </div>
        )}

        {/* ── Top hint ────────────────────────────────────────────────────── */}
        <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
          <p className="font-body text-white/50 text-xs tracking-wide">
            Drag to reposition · scroll or pinch to zoom
          </p>
        </div>

        {/* ── Bottom action row ────────────────────────────────────────────── */}
        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-between px-8">
          <button
            type="button"
            onClick={handleCropCancel}
            disabled={cropUploading}
            className="font-body text-white text-sm font-medium disabled:opacity-40 hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCropApply()}
            disabled={cropUploading}
            className="font-body bg-white text-[#1A1A1A] text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-40 hover:bg-white/90 transition-colors"
          >
            {cropUploading ? 'Uploading…' : 'Apply'}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
