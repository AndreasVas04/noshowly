-- Migration: baseline schema.
--
-- The database as it was before 20260928120000_security_hardening.sql: the old
-- supabase/schema.sql plus every supabase/add_*.sql file, merged into one file
-- (tables, columns, constraints, indexes and policies are unchanged).
--
-- On a new database (supabase db reset, or a new project) it builds the whole
-- schema. The live project already has all of it and only needs this version
-- marked as applied (see supabase/README.md).
--
-- It is safe to run again. Tables and indexes are created only when missing.
-- Policies, the unused staff_services table and two indexes are changed or
-- removed by later migrations, so they are created only on a new database and
-- a second run does not bring them back.
--
-- Unlike the old add_email_reminders_counter.sql, the plan CHECK is part of
-- CREATE TABLE, so nothing has to look it up (that lookup matched the NOT NULL
-- constraint on a new database and failed).

BEGIN;

SELECT set_config('noshowly.new_database', (to_regclass('public.users') IS NULL)::text, true);

-- pg_cron runs the reminder job (see 20260609000100_platform_setup.sql).
-- Skipped on servers that do not have the extension.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  ELSE
    RAISE NOTICE 'pg_cron is not available on this server, skipped';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not enabled: %', SQLERRM;
END $$;


-- TABLES

-- One row per account, created by /api/auth/register with the service-role key.
CREATE TABLE IF NOT EXISTS public.users (
  id                              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                           TEXT        NOT NULL,
  stripe_customer_id              TEXT,
  plan                            TEXT        NOT NULL DEFAULT 'trial',
  trial_ends_at                   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  reminders_used_this_month       INTEGER     NOT NULL DEFAULT 0,   -- legacy counter
  reminders_reset_at              TIMESTAMPTZ NOT NULL DEFAULT (DATE_TRUNC('month', NOW()) + INTERVAL '1 month'),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_reminders_used_this_month INTEGER     NOT NULL DEFAULT 0,
  -- Plan names from lib/plans.ts, plus legacy SMS-era names found in older rows.
  CONSTRAINT users_plan_check CHECK (plan IN (
    'trial',
    'basic', 'pro', 'business',
    'starter', 'professional',
    'solo-sms', 'team-sms', 'studio-sms',
    'solo-email', 'team-email', 'studio-email',
    'solo-both', 'team-both', 'studio-both',
    'cancelled'
  ))
);

CREATE TABLE IF NOT EXISTS public.salons (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name                       TEXT        NOT NULL,
  phone                      TEXT,
  timezone                   TEXT        NOT NULL DEFAULT 'UTC',
  sms_sender_name            TEXT,       -- legacy column (unused — product is email-only)
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Business hours (clock time). NULL = not configured yet.
  opening_time               TIME,
  closing_time               TIME,
  sms_confirmation_enabled   BOOLEAN     NOT NULL DEFAULT true,   -- legacy column (unused)
  -- Whether email reminders include YES/NO confirmation buttons.
  email_confirmation_enabled BOOLEAN     NOT NULL DEFAULT true,
  currency                   TEXT        NOT NULL DEFAULT 'USD',
  -- Email template fields. NULL = application default from lib/reminder-templates.ts.
  email_subject              TEXT,
  email_greeting             TEXT,
  email_body                 TEXT,
  email_closing              TEXT,
  sms_template               TEXT,       -- legacy column (unused)
  email_footer               TEXT
);

-- Staff labels (dropdown items) — NOT login accounts.
CREATE TABLE IF NOT EXISTS public.barbers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_url  TEXT,
  bio        TEXT,
  active     BOOLEAN     NOT NULL DEFAULT true
);

-- End customers. They never log in — they only receive email reminders.
CREATE TABLE IF NOT EXISTS public.clients (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status flow: scheduled -> confirmed (client replied YES) | cancelled (NO)
CREATE TABLE IF NOT EXISTS public.appointments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id        UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  barber_id        UUID        REFERENCES public.barbers(id) ON DELETE SET NULL,
  datetime         TIMESTAMPTZ NOT NULL,
  service_type     TEXT,
  duration_minutes INTEGER     NOT NULL DEFAULT 30,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'scheduled',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks each email reminder sent (or attempted).
-- token: single-use value embedded in the YES/NO button URLs (/api/confirm/[token]).
CREATE TABLE IF NOT EXISTS public.reminders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL,   -- 'email' (legacy rows may contain 'sms')
  send_at        TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token          TEXT        UNIQUE
);

-- Per-salon service catalogue.
CREATE TABLE IF NOT EXISTS public.services (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID          NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name             TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER,
  price            DECIMAL(10,2),
  active           BOOLEAN       NOT NULL DEFAULT true
);

-- Public booking page: one per salon, slug-based public URL.
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                    UUID        NOT NULL UNIQUE REFERENCES public.salons(id) ON DELETE CASCADE,
  slug                        TEXT        NOT NULL UNIQUE,
  is_active                   BOOLEAN     NOT NULL DEFAULT false,
  description                 TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  custom_title                TEXT,
  custom_intro                TEXT,
  require_phone               BOOLEAN     NOT NULL DEFAULT true,
  require_email               BOOLEAN     NOT NULL DEFAULT true,
  allow_no_preference_staff   BOOLEAN     NOT NULL DEFAULT false,
  allow_no_preference_service BOOLEAN     NOT NULL DEFAULT false
);

-- Links salon-level services to specific staff. No rows for a service = all
-- staff available. Overrides: NULL = use the service default.
CREATE TABLE IF NOT EXISTS public.barber_services (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                  UUID          NOT NULL REFERENCES public.salons(id)   ON DELETE CASCADE,
  barber_id                 UUID          NOT NULL REFERENCES public.barbers(id)  ON DELETE CASCADE,
  service_id                UUID          NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  price_override            DECIMAL(10,2),
  duration_minutes_override INTEGER,
  UNIQUE (barber_id, service_id)
);

-- Staff availability for online booking.
-- day_of_week: 0 = Sunday .. 6 = Saturday (matches Date.getDay()).
-- time_slots is the source of truth: [{"start": "09:00", "end": "13:00"}, ...].
-- start_time_1/2 and end_time_1/2 are kept for compatibility.
CREATE TABLE IF NOT EXISTS public.staff_availability (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id    UUID    NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_available BOOLEAN NOT NULL DEFAULT true,
  start_time_1 TIME,
  end_time_1   TIME,
  start_time_2 TIME,
  end_time_2   TIME,
  time_slots   JSONB   DEFAULT '[]'::jsonb,
  UNIQUE (barber_id, day_of_week),
  CONSTRAINT staff_availability_time_slots_is_array CHECK (jsonb_typeof(time_slots) = 'array')
);

-- Per-staff service list. Never used by the app; dropped by
-- 20260928130000_data_integrity.sql.
DO $$
BEGIN
  IF current_setting('noshowly.new_database')::boolean THEN
    CREATE TABLE public.staff_services (
      id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      barber_id        UUID          NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
      name             TEXT          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
      duration_minutes INTEGER       CHECK (duration_minutes > 0),
      price            DECIMAL(10,2) CHECK (price >= 0),
      active           BOOLEAN       NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;


-- INDEXES

CREATE INDEX IF NOT EXISTS idx_appointments_salon_datetime
  ON public.appointments (salon_id, datetime);

-- Partial index for the cron job scan.
CREATE INDEX IF NOT EXISTS idx_reminders_status_send_at
  ON public.reminders (status, send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_barbers_salon_id
  ON public.barbers (salon_id);

CREATE INDEX IF NOT EXISTS idx_clients_salon_id
  ON public.clients (salon_id);

-- Both dropped by 20260928130000_data_integrity.sql.
DO $$
BEGIN
  IF current_setting('noshowly.new_database')::boolean THEN
    CREATE INDEX idx_appointments_status
      ON public.appointments (status);
    CREATE UNIQUE INDEX idx_reminders_token
      ON public.reminders (token)
      WHERE token IS NOT NULL;
  END IF;
END $$;


-- ROW LEVEL SECURITY
-- Each salon owner can only access their own data.

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT current_setting('noshowly.new_database')::boolean THEN
    RETURN;
  END IF;

  -- users: owner can read/update own row. Insert handled by the service-role key.
  CREATE POLICY "users: owner select"
    ON public.users FOR SELECT
    USING (id = auth.uid());

  CREATE POLICY "users: owner update"
    ON public.users FOR UPDATE
    USING (id = auth.uid());

  -- salons
  CREATE POLICY "salons: owner all"
    ON public.salons FOR ALL
    USING (user_id = auth.uid());

  -- barbers: scoped to owner's salon via sub-select.
  CREATE POLICY "barbers: owner all"
    ON public.barbers FOR ALL
    USING (
      salon_id IN (
        SELECT id FROM public.salons WHERE user_id = auth.uid()
      )
    );

  -- clients
  CREATE POLICY "clients: owner all"
    ON public.clients FOR ALL
    USING (
      salon_id IN (
        SELECT id FROM public.salons WHERE user_id = auth.uid()
      )
    );

  -- appointments
  CREATE POLICY "appointments: owner all"
    ON public.appointments FOR ALL
    USING (
      salon_id IN (
        SELECT id FROM public.salons WHERE user_id = auth.uid()
      )
    );

  -- reminders: scoped via appointments -> salons -> auth.uid() (no direct salon_id column).
  CREATE POLICY "reminders: owner all"
    ON public.reminders FOR ALL
    USING (
      appointment_id IN (
        SELECT id FROM public.appointments
        WHERE salon_id IN (
          SELECT id FROM public.salons WHERE user_id = auth.uid()
        )
      )
    );

  -- services
  CREATE POLICY "Users own services"
    ON public.services FOR ALL
    USING (
      salon_id IN (SELECT id FROM public.salons WHERE user_id = auth.uid())
    );

  -- booking_pages
  CREATE POLICY "Users own booking page"
    ON public.booking_pages FOR ALL
    USING (
      salon_id IN (
        SELECT id FROM public.salons WHERE user_id = auth.uid()
      )
    );

  -- barber_services
  CREATE POLICY "Owner can read barber_services"
    ON public.barber_services FOR SELECT
    USING (
      salon_id IN (SELECT id FROM public.salons WHERE user_id = auth.uid())
    );

  CREATE POLICY "Owner can manage barber_services"
    ON public.barber_services FOR ALL
    USING (
      salon_id IN (SELECT id FROM public.salons WHERE user_id = auth.uid())
    )
    WITH CHECK (
      salon_id IN (SELECT id FROM public.salons WHERE user_id = auth.uid())
    );

  -- staff_availability: ownership traced via barber -> salon -> user.
  CREATE POLICY "Users own staff availability"
    ON public.staff_availability FOR ALL
    USING (
      barber_id IN (
        SELECT b.id
        FROM   public.barbers b
        JOIN   public.salons  s ON s.id = b.salon_id
        WHERE  s.user_id = auth.uid()
      )
    );

  -- staff_services: staff_services -> barbers -> salons -> users.
  CREATE POLICY "Users own staff services"
    ON public.staff_services FOR ALL
    USING (
      barber_id IN (
        SELECT b.id
        FROM   public.barbers b
        JOIN   public.salons  s ON s.id = b.salon_id
        WHERE  s.user_id = auth.uid()
      )
    );

  -- Public reads for the unauthenticated booking flow.
  CREATE POLICY "Public can view salon info for booking"
    ON public.salons FOR SELECT USING (true);

  CREATE POLICY "Public can view active barbers"
    ON public.barbers FOR SELECT USING (active = true);

  CREATE POLICY "Public can view active services"
    ON public.services FOR SELECT USING (active = true);

  CREATE POLICY "Public can view active booking pages"
    ON public.booking_pages FOR SELECT USING (is_active = true);

  CREATE POLICY "Public can view staff availability"
    ON public.staff_availability FOR SELECT USING (true);

  CREATE POLICY "Public can view active staff services"
    ON public.staff_services FOR SELECT USING (active = true);

  -- Public can INSERT appointments via the booking page.
  CREATE POLICY "Public can create appointments via booking"
    ON public.appointments FOR INSERT WITH CHECK (true);
END $$;

COMMIT;
