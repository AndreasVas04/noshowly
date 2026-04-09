/**
 * types/index.ts
 *
 * TypeScript types for all NoShowly database tables and the Supabase Database
 * generic used to type the Supabase client throughout the codebase.
 *
 * Keep these in sync with the SQL schema in CLAUDE.md whenever the schema changes.
 * These types are the single source of truth for TypeScript — the DB is the source
 * of truth for the actual data.
 *
 * NOTE: PlanType and UserPlan are defined in lib/plans.ts (derived from PLAN_LIMITS)
 * and re-exported here so callers that only import from @/types get everything they need.
 */

// Import plan types from lib/plans (canonical definition) for use in this file,
// then re-export them so callers that import from @/types get everything they need.
// PlanType  = 'trial' | 'solo' | 'salon' | 'studio'  (active plans only)
// UserPlan  = PlanType | 'cancelled'                  (full DB column set)
import type { PlanType, UserPlan } from '@/lib/plans';
export type { PlanType, UserPlan };

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
 */
export type Service = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** Display name of the service, e.g. "Haircut", "Beard trim". */
  name: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Table row shapes (match the Supabase-managed columns exactly)
// ---------------------------------------------------------------------------

/**
 * Row in the `users` table — extends auth.users with NoShowly-specific fields.
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
  /** Counter reset monthly; used to enforce plan reminder limits. */
  reminders_used_this_month: number;
  /** ISO timestamp for the next monthly reset of reminders_used_this_month. */
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
  /** Name shown in SMS: "Hi, reminder from [sms_sender_name]". */
  sms_sender_name: string | null;
  /** Opening time in HH:MM 24-hour format, e.g. "09:00". Null if not yet set. */
  opening_time: string | null;
  /** Closing time in HH:MM 24-hour format, e.g. "20:00". Null if not yet set. */
  closing_time: string | null;
  created_at: string;
}

/**
 * Row in the `barbers` table.
 * Barbers are display labels (dropdown items) — they do NOT have login accounts.
 */
export type Barber = {
  id: string;
  /** FK → salons.id */
  salon_id: string;
  /** First name or display name, e.g. "John". */
  name: string;
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
          sms_sender_name?: string | null;
          opening_time?: string | null;
          closing_time?: string | null;
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
          created_at?: string;
        };
        Update: Partial<Omit<Service, 'id'>>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
  };
}
