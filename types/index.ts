/**
 * types/index.ts
 *
 * TypeScript types for all NoShowly database tables and the Supabase Database
 * generic used to type the Supabase client throughout the codebase.
 *
 * Keep these in sync with the SQL schema (supabase/migrations) whenever the schema changes.
 * These types are the single source of truth for TypeScript — the DB is the source
 * of truth for the actual data.
 *
 * Plan types (PlanType, PaidPlan, UserPlan, CanonicalPlan) are defined in
 * lib/plans.ts and imported from there.
 */

// UserPlan      = a PLAN_LIMITS key or 'cancelled'.
// CanonicalPlan = the plans the database (users_plan_check) accepts: 'trial' |
//                 'basic' | 'pro' | 'business' | 'cancelled' (parsePlan() in
//                 lib/entitlements.ts maps the legacy 'starter' and 'professional').
import type { CanonicalPlan, UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Enum-like string union types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of an appointment.
 * 'scheduled'  — Newly created, reminder not yet sent or awaiting reply.
 * 'confirmed'  — Client replied YES to the reminder.
 * 'cancelled'  — Client replied NO to the reminder.
 */
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'cancelled';

/**
 * Kind of reminder row.
 * 'email'              — The 24-hour reminder with YES/NO buttons. At most one per appointment
 *                        may be pending or sent (reminders_one_email_per_appointment).
 * 'email_confirmation' — Booking confirmation sent right after a booking.
 * 'email_test'         — Manual test send from the dashboard.
 * 'sms'                — Legacy rows only; the product is email-only.
 */
type ReminderType = 'email' | 'email_confirmation' | 'email_test' | 'sms';

/**
 * Processing state of a single reminder record.
 * 'pending'   — Queued, not yet sent.
 * 'sent'      — Successfully delivered.
 * 'failed'    — Delivery attempt failed (will not auto-retry without manual intervention).
 * 'confirmed' — Client responded YES.
 * 'cancelled' — Client responded NO, or the appointment was cancelled before sending.
 * 'skipped'   — Never sent and never will be (e.g. the appointment was cancelled or has passed).
 */
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'confirmed' | 'cancelled' | 'skipped';

/**
 * Type of service being performed in an appointment.
 * Now a plain string alias — services are defined per-salon in the services table.
 */
type ServiceType = string;

/**
 * Row in the `services` table — custom service names defined by each salon.
 * Services appear as a dropdown when the salon owner adds an appointment.
 * Includes optional duration and price fields for display on the public booking page.
 */
export type Service = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** Display name of the service, e.g. "Haircut", "Beard trim". */
  name: string;
  /** Optional duration in minutes, 1–480, e.g. 30. Null if not set. */
  duration_minutes: number | null;
  /** Optional displayed price, never negative. Null means no price shown. */
  price: number | null;
  /** Whether the service is visible on the booking page and appointment modal. */
  active: boolean;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Table row shapes (match the Supabase-managed columns exactly)
// ---------------------------------------------------------------------------

/**
 * Row in the `users` table — extends auth.users with Noshowly-specific fields.
 */
type User = {
  /** UUID from auth.users — primary key. */
  id: string;
  email: string;
  /** Stripe customer ID, set when the user starts a paid subscription. */
  stripe_customer_id: string | null;
  /** Full plan column — includes 'cancelled' for lapsed subscriptions. */
  plan: UserPlan;
  /** ISO timestamp when the trial expires. */
  trial_ends_at: string;
  /** Legacy monthly SMS reminder counter. No longer incremented — kept for DB compatibility. */
  reminders_used_this_month: number;
  /** Monthly email reminder counter. Enforced against getPlanEmailLimit(plan). */
  email_reminders_used_this_month: number;
  /** ISO timestamp for the next monthly reset of both reminder counters. */
  reminders_reset_at: string;
  created_at: string;
}

/**
 * Row in the `salons` table — one per user account.
 */
export type Salon = {
  id: string;
  /** FK → users.id */
  user_id: string;
  /** Display name of the salon, e.g. "Salon Elena". */
  name: string;
  /** The salon's own contact phone number (not used for sending reminders). */
  phone: string | null;
  /** IANA timezone string, e.g. "America/New_York". */
  timezone: string;
  /** Opening time in HH:MM 24-hour format, e.g. "09:00". Null if not yet set. */
  opening_time: string | null;
  /** Closing time in HH:MM 24-hour format, e.g. "20:00". Must be after opening_time. Null if not yet set. */
  closing_time: string | null;
  /**
   * Custom email footer text. Supports {business_name} placeholder.
   * Null → use application default.
   */
  email_footer: string | null;
  /**
   * Custom subject line of the 24-hour reminder email. Supports {business_name}
   * (and the other template variables). Null → use application default
   * ("Reminder: Your appointment at {business_name} on {date} at {time}").
   */
  email_subject: string | null;
  /**
   * Custom email greeting line. Supports {client_name}, {business_name}, {service}, {time}, {date}.
   * Null → use application default ("Hi {client_name},").
   */
  email_greeting: string | null;
  /**
   * Custom email body paragraph. Supports {client_name}, {business_name}, {service}, {time}, {date}.
   * Null → use application default ("This is a reminder for your upcoming appointment.").
   */
  email_body: string | null;
  /**
   * Custom email closing message shown when confirmation buttons are disabled.
   * Supports {client_name}, {business_name}, {service}, {time}, {date}.
   * Null → use application default ("We look forward to seeing you.").
   */
  email_closing: string | null;
  /** ISO 4217 currency code used for price display on the booking page, e.g. 'USD', 'EUR'. */
  currency: string;
  /** Whether email reminders include YES/NO confirmation buttons. Default true. */
  email_confirmation_enabled: boolean;
  created_at: string;
}

/**
 * Row in the `barbers` table.
 * Barbers are display labels (dropdown items) — they do NOT have login accounts.
 * Includes optional photo and bio fields for display on the public booking page.
 */
export type Barber = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** First name or display name, e.g. "John". */
  name: string;
  /** Optional profile photo URL (e.g. a Supabase Storage public URL). Null if not set. */
  photo_url: string | null;
  /** Optional short bio shown on the public booking page. Null if not set. */
  bio: string | null;
  /** Whether the staff member is visible on the booking page and appointment modal. */
  active: boolean;
  created_at: string;
}

/**
 * Row in the `clients` table — the salon's end customers.
 * Clients NEVER log in; they only receive email reminders and reply YES/NO.
 */
export type Client = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  name: string;
  /** Contact number; null for clients who booked online without one. */
  phone: string | null;
  /** Optional; used for email reminders. */
  email: string | null;
  /** Free-text notes for the barber, e.g. "allergic to X product". */
  notes: string | null;
  created_at: string;
}

/**
 * Row in the `appointments` table.
 */
export type Appointment = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** FK → clients.id — nullable in case client record is deleted. */
  client_id: string | null;
  /** FK → barbers.id — nullable in case barber record is deleted. */
  barber_id: string | null;
  /** ISO timestamp of the appointment start time (stored in UTC). */
  datetime: string;
  service_type: ServiceType | null;
  /**
   * Length in minutes, 1–480. A barber cannot have two overlapping appointments
   * that are not cancelled (appointments_no_double_booking, error 23P01).
   */
  duration_minutes: number;
  notes: string | null;
  status: AppointmentStatus;
  created_at: string;
}

/**
 * Row in the `reminders` table — one row per email (legacy rows may have type 'sms').
 */
type Reminder = {
  id: string;
  /** FK → appointments.id */
  appointment_id: string;
  type: ReminderType;
  /** ISO timestamp when this reminder was scheduled to send. */
  send_at: string;
  /** ISO timestamp when this reminder was actually sent; null if not yet sent. */
  sent_at: string | null;
  status: ReminderStatus;
  /**
   * Single-use token for the email confirmation link (/api/confirm/[token]).
   * Generated via crypto.randomUUID() at reminder creation time.
   * Null on rows created before reminder tokens existed.
   */
  token: string | null;
  created_at: string;
}

/** A single time slot: start and end in HH:MM 24-hour format. */
export type TimeSlot = { start: string; end: string };

/**
 * Row in the `staff_availability` table.
 * One row per barber per day of week. day_of_week follows JavaScript's Date.getDay()
 * convention: 0 = Sunday, 1 = Monday, …, 6 = Saturday.
 *
 * time_slots (JSONB, primary) stores an array of { start, end } objects for unlimited breaks.
 * start_time_1/end_time_1/start_time_2/end_time_2 retained for backwards compatibility.
 */
export type StaffAvailability = {
  id: string;
  /** FK → barbers.id */
  barber_id: string;
  /** 0 = Sunday, 1 = Monday, …, 6 = Saturday. Matches Date.getDay(). */
  day_of_week: number;
  /** Whether the staff member works on this day at all. */
  is_available: boolean;
  /** Primary: array of time slots, e.g. [{ start: "09:00", end: "13:00" }]. */
  time_slots: TimeSlot[] | null;
  /** Legacy: first slot start time, HH:MM. Kept for backwards compatibility. */
  start_time_1: string | null;
  /** Legacy: first slot end time, HH:MM. Kept for backwards compatibility. */
  end_time_1: string | null;
  /** Legacy: second slot start time. Kept for backwards compatibility. */
  start_time_2: string | null;
  /** Legacy: second slot end time. Kept for backwards compatibility. */
  end_time_2: string | null;
};

/**
 * Row in the `barber_services` table — links salon-level services to specific barbers.
 *
 * Used by the dashboard appointment modal to filter the staff dropdown to only
 * show barbers that offer the selected service, and to validate appointments
 * server-side (if any assignments exist for a service, barbers not in that set
 * are rejected).
 *
 * Uses FKs to both the barbers and services tables.
 *
 * price_override and duration_minutes_override allow individual staff members to have
 * different pricing or duration for the same service. NULL means "use global default".
 */
export type BarberService = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** FK → barbers.id */
  barber_id: string;
  /** FK → services.id */
  service_id: string;
  /** Optional price override for this barber/service pair. Null = use global service price. */
  price_override: number | null;
  /** Optional duration override in minutes for this barber/service pair. Null = use global service duration. */
  duration_minutes_override: number | null;
  created_at: string;
};

/**
 * Row in the `booking_pages` table — one optional public booking page per salon.
 * The owner creates and activates this page to allow clients to self-book.
 * Public URL pattern: /book/[slug]
 */
export type BookingPage = {
  id: string;
  /** FK → salons.id — one booking page per salon. */
  salon_id: string;
  /** URL-friendly slug, e.g. "salon-elena": a-z, 0-9 and hyphens. Globally unique, ignoring case. */
  slug: string;
  /** Whether the public booking page is live. False by default. */
  is_active: boolean;
  /** Optional description shown at the top of the public booking page. */
  description: string | null;
  /** Custom h1 heading shown on the public booking page. Falls back to salon name when null. */
  custom_title: string | null;
  /** Optional welcome message shown below the title on the public booking page. */
  custom_intro: string | null;
  /** Whether clients must supply a phone number when self-booking. Default true. */
  require_phone: boolean;
  /** Whether clients must supply an email address when self-booking. Default true. */
  require_email: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Joined / derived shapes used by API responses and frontend components
// ---------------------------------------------------------------------------

/**
 * An appointment row with client and barber display names flattened in.
 *
 * Returned by GET /api/appointments so the frontend never needs to make
 * extra round-trips to resolve foreign keys for display purposes.
 *
 * - client_name  — pulled from the related clients row (null if deleted).
 * - client_phone — pulled from the related clients row (null if no phone).
 * - client_email — pulled from the related clients row (null if no email).
 * - barber_name  — pulled from the related barbers row (null if deleted/unassigned).
 */
export type AppointmentWithDetails = Appointment & {
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  barber_name: string | null;
};

/**
 * A Stripe subscription as the Billing section in Settings shows it
 * (GET /api/billing). Timestamps are ISO strings.
 */
export type BillingSubscription = {
  /** Stripe status: active, trialing, past_due, unpaid, incomplete, paused. */
  status: string;
  /** The subscription ends at the end of the current period instead of renewing. */
  cancelAtPeriodEnd: boolean;
  /** End of the current billing period, or null. */
  currentPeriodEnd: string | null;
  /** When the subscription is set to end, or null. */
  cancelAt: string | null;
};

/**
 * Response of GET /api/billing: the owner's plan and what it allows
 * (lib/entitlements.ts, without the internal email caps) and their Stripe
 * subscription.
 */
export type BillingOverview = {
  plan: CanonicalPlan;
  /** Plan name as shown to the owner, e.g. "Free trial", "Basic". */
  planLabel: string;
  isPaid: boolean;
  isTrial: boolean;
  /** When the free trial ends or ended (ISO), or null. */
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  trialExpired: boolean;
  canWrite: boolean;
  canSendEmail: boolean;
  /** The public demo account: billing actions are hidden. */
  isDemo: boolean;
  /** The owner has a Stripe customer, so "Manage billing" can open the portal. */
  hasBillingAccount: boolean;
  /** The subscription to describe, or null when there is none that has not ended. */
  subscription: BillingSubscription | null;
  /** Stripe could not be reached; `subscription` is unknown. */
  billingUnavailable: boolean;
};

// ---------------------------------------------------------------------------
// Public booking page shapes
// Read server-side (lib/booking-data.ts) and passed to the public booking UI.
// Only the fields a visitor needs — never client data.
// ---------------------------------------------------------------------------

/** Booking page settings shown to visitors. */
export type PublicBookingPage = Pick<
  BookingPage,
  'slug' | 'description' | 'custom_title' | 'custom_intro' | 'require_phone' | 'require_email'
>;

/**
 * Salon fields shown to visitors. `timezone` is always a valid IANA name and
 * opening/closing times are 'HH:MM' (or null when not set).
 */
export type PublicSalon = Pick<
  Salon,
  'name' | 'timezone' | 'phone' | 'currency' | 'opening_time' | 'closing_time'
>;

/** An active staff member as shown on the booking page. */
export type PublicBarber = Pick<Barber, 'id' | 'name' | 'photo_url' | 'bio'>;

/** An active service as shown on the booking page. */
export type PublicService = Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price'>;

/** A staff/service link with optional per-staff price and duration. */
export type PublicServiceAssignment = Pick<
  BarberService,
  'barber_id' | 'service_id' | 'price_override' | 'duration_minutes_override'
>;

/** Weekly availability of an active staff member. */
export type PublicAvailability = Pick<
  StaffAvailability,
  | 'barber_id'
  | 'day_of_week'
  | 'is_available'
  | 'time_slots'
  | 'start_time_1'
  | 'end_time_1'
  | 'start_time_2'
  | 'end_time_2'
>;

/**
 * Time taken by a non-cancelled appointment, used to hide booked times.
 * Deliberately carries no client, service or note information.
 */
export type PublicBusyInterval = Pick<Appointment, 'barber_id' | 'datetime' | 'duration_minutes'>;

// ---------------------------------------------------------------------------
// Supabase Database generic type
// Required by createBrowserClient<Database> / createServerClient<Database>.
// ---------------------------------------------------------------------------

/**
 * Full database type passed to the Supabase client generic so every query
 * is strongly typed (column names, value types, return shapes).
 */
export type Database = {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: {
          /** Must match the auth.users UUID created by Supabase Auth. */
          id: string;
          email: string;
          stripe_customer_id?: string | null;
          /** Defaults to 'trial' if omitted. */
          plan?: UserPlan;
          trial_ends_at?: string;
          reminders_used_this_month?: number;
          /** Defaults to 0 if omitted. */
          email_reminders_used_this_month?: number;
          reminders_reset_at?: string;
          created_at?: string;
        };
        Update: Partial<Omit<User, 'id'>>;
        /** No typed FK relationships needed at this stage. */
        Relationships: [];
      };
      salons: {
        Row: Salon;
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone?: string | null;
          /** Defaults to 'UTC' if omitted. */
          timezone?: string;
          opening_time?: string | null;
          closing_time?: string | null;
          email_footer?: string | null;
          email_subject?: string | null;
          email_greeting?: string | null;
          email_body?: string | null;
          email_closing?: string | null;
          /** ISO 4217 currency code. Defaults to 'USD'. */
          currency?: string;
          /** Defaults to true if omitted. */
          email_confirmation_enabled?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Salon, 'id'>>;
        Relationships: [];
      };
      barbers: {
        Row: Barber;
        Insert: {
          id?: string;
          salon_id: string;
          name: string;
          photo_url?: string | null;
          bio?: string | null;
          /** Defaults to true if omitted. */
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Barber, 'id'>>;
        Relationships: [];
      };
      clients: {
        Row: Client;
        Insert: {
          id?: string;
          salon_id: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<Client, 'id'>>;
        Relationships: [];
      };
      appointments: {
        Row: Appointment;
        Insert: {
          id?: string;
          salon_id: string;
          client_id?: string | null;
          barber_id?: string | null;
          datetime: string;
          service_type?: ServiceType | null;
          /** Defaults to 30 if omitted. */
          duration_minutes?: number;
          notes?: string | null;
          /** Defaults to 'scheduled' if omitted. */
          status?: AppointmentStatus;
          created_at?: string;
        };
        Update: Partial<Omit<Appointment, 'id'>>;
        Relationships: [];
      };
      reminders: {
        Row: Reminder;
        Insert: {
          id?: string;
          appointment_id: string;
          type: ReminderType;
          send_at: string;
          sent_at?: string | null;
          /** Defaults to 'pending' if omitted. */
          status?: ReminderStatus;
          /** Single-use confirmation token. Generated via crypto.randomUUID(). */
          token?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<Reminder, 'id'>>;
        Relationships: [];
      };
      services: {
        Row: Service;
        Insert: {
          id?: string;
          salon_id: string;
          name: string;
          duration_minutes?: number | null;
          price?: number | null;
          /** Defaults to true if omitted. */
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Service, 'id'>>;
        Relationships: [];
      };
      booking_pages: {
        Row: BookingPage;
        Insert: {
          id?: string;
          salon_id: string;
          slug: string;
          /** Defaults to false if omitted — owner must explicitly activate. */
          is_active?: boolean;
          description?: string | null;
          custom_title?: string | null;
          custom_intro?: string | null;
          require_phone?: boolean;
          require_email?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<BookingPage, 'id'>>;
        Relationships: [];
      };
      staff_availability: {
        Row: StaffAvailability;
        Insert: {
          id?: string;
          barber_id: string;
          /** 0 = Sunday … 6 = Saturday. */
          day_of_week: number;
          is_available?: boolean;
          time_slots?: TimeSlot[] | null;
          start_time_1?: string | null;
          end_time_1?: string | null;
          start_time_2?: string | null;
          end_time_2?: string | null;
        };
        Update: Partial<Omit<StaffAvailability, 'id'>>;
        Relationships: [];
      };
      barber_services: {
        Row: BarberService;
        Insert: {
          id?: string;
          salon_id: string;
          barber_id: string;
          service_id: string;
          price_override?: number | null;
          duration_minutes_override?: number | null;
          created_at?: string;
        };
        Update: Partial<Omit<BarberService, 'id'>>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
  };
}
