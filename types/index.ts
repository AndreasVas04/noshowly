/**
 * types/index.ts
 *
 * TypeScript types for all NoShowly database tables and the Supabase Database
 * generic used to type the Supabase client throughout the codebase.
 *
 * Keep these in sync with the SQL schema whenever the schema changes.
 * These types are the single source of truth for TypeScript — the DB is the source
 * of truth for the actual data.
 *
 * NOTE: PlanType and UserPlan are defined in lib/plans.ts (derived from PLAN_LIMITS)
 * and re-exported here so callers that only import from @/types get everything they need.
 */

// Import plan types from lib/plans (canonical definition) for use in this file,
// then re-export them so callers that import from @/types get everything they need.
// PlanType  = 'trial' | 'solo-sms' | 'team-sms' | ... (9 paid + trial)
// PaidPlan  = Exclude<PlanType, 'trial'>               (9 paid plans only)
// UserPlan  = PlanType | 'cancelled'                   (full DB column set)
import type { PlanType, PaidPlan, UserPlan } from '@/lib/plans';
export type { PlanType, PaidPlan, UserPlan };

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
 * Channel through which a reminder is delivered.
 */
export type ReminderType = 'sms' | 'email';

/**
 * Processing state of a single reminder record.
 * 'pending'   — Queued, not yet sent.
 * 'sent'      — Successfully delivered.
 * 'failed'    — Delivery attempt failed (will not auto-retry without manual intervention).
 * 'confirmed' — Client responded YES.
 * 'cancelled' — Client responded NO.
 */
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'confirmed' | 'cancelled';

/**
 * Type of service being performed in an appointment.
 * Now a plain string alias — services are defined per-salon in the services table.
 */
export type ServiceType = string;

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
  /** Optional duration hint in minutes, e.g. 30. Null if not set. */
  duration_minutes: number | null;
  /** Optional displayed price. Null means no price shown. */
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
export type User = {
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
  /** Closing time in HH:MM 24-hour format, e.g. "20:00". Null if not yet set. */
  closing_time: string | null;
  /**
   * Custom SMS reminder template. Supports {client_name}, {business_name},
   * {service}, {time}, {date} placeholders. Null → use application default.
   */
  sms_template: string | null;
  /**
   * Custom email footer text. Supports {business_name} placeholder.
   * Null → use application default.
   */
  email_footer: string | null;
  /**
   * Custom email subject line. Supports {business_name} placeholder.
   * Null → use application default ("Reminder: Your appointment at {business_name} tomorrow").
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
  /** Whether SMS reminders include a YES/NO confirmation request. Default true. */
  sms_confirmation_enabled: boolean;
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
 * Clients NEVER log in; they only receive SMS/email reminders and reply YES/NO.
 */
export type Client = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  name: string;
  /** Required for SMS reminders. */
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
  duration_minutes: number;
  notes: string | null;
  status: AppointmentStatus;
  created_at: string;
}

/**
 * Row in the `reminders` table — one row per SMS or email sent.
 */
export type Reminder = {
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
   * Null on rows created before the add_reminder_token.sql migration.
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
  /** URL-friendly slug, e.g. "salon-elena". Must be globally unique. */
  slug: string;
  /** Whether the public booking page is live. False by default. */
  is_active: boolean;
  /** Optional description shown at the top of the public booking page. */
  description: string | null;
  /** Whether clients can select "No preference" for staff on the booking page. */
  allow_no_preference_staff: boolean;
  /** Whether clients can select "No preference" for service on the booking page. */
  allow_no_preference_service: boolean;
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
          sms_template?: string | null;
          email_footer?: string | null;
          email_subject?: string | null;
          email_greeting?: string | null;
          email_body?: string | null;
          email_closing?: string | null;
          /** ISO 4217 currency code. Defaults to 'USD'. */
          currency?: string;
          /** Defaults to true if omitted. */
          sms_confirmation_enabled?: boolean;
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
          allow_no_preference_staff?: boolean;
          allow_no_preference_service?: boolean;
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
