-- Noshowly — Database Schema + RLS Policies

CREATE EXTENSION IF NOT EXISTS pg_cron;


-- TABLES

CREATE TABLE IF NOT EXISTS public.users (
  id                       UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    TEXT        NOT NULL,
  stripe_customer_id       TEXT,
  plan                     TEXT        NOT NULL DEFAULT 'trial',
  trial_ends_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  reminders_used_this_month INTEGER    NOT NULL DEFAULT 0,   -- legacy counter (kept for compatibility)
  reminders_reset_at       TIMESTAMPTZ NOT NULL DEFAULT (DATE_TRUNC('month', NOW()) + INTERVAL '1 month'),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.salons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  phone           TEXT,
  timezone        TEXT        NOT NULL DEFAULT 'UTC',
  sms_sender_name TEXT,       -- legacy column (unused — product is email-only)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff labels (dropdown items) — NOT login accounts.
CREATE TABLE IF NOT EXISTS public.barbers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE TABLE IF NOT EXISTS public.reminders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL,   -- 'email' (legacy rows may contain 'sms')
  send_at        TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- INDEXES

CREATE INDEX IF NOT EXISTS idx_appointments_salon_datetime
  ON public.appointments (salon_id, datetime);

CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON public.appointments (status);

-- Partial index for the hourly cron job scan.
CREATE INDEX IF NOT EXISTS idx_reminders_status_send_at
  ON public.reminders (status, send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_barbers_salon_id
  ON public.barbers (salon_id);

CREATE INDEX IF NOT EXISTS idx_clients_salon_id
  ON public.clients (salon_id);


-- ROW LEVEL SECURITY
-- Each salon owner can only access their own data.

ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders    ENABLE ROW LEVEL SECURITY;

-- users: owner can read/update own row. Insert handled by service-role key in /api/auth/register.
DROP POLICY IF EXISTS "users: owner select" ON public.users;
CREATE POLICY "users: owner select"
  ON public.users FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "users: owner update" ON public.users;
CREATE POLICY "users: owner update"
  ON public.users FOR UPDATE
  USING (id = auth.uid());

-- salons
DROP POLICY IF EXISTS "salons: owner all" ON public.salons;
CREATE POLICY "salons: owner all"
  ON public.salons FOR ALL
  USING (user_id = auth.uid());

-- barbers: scoped to owner's salon via sub-select.
DROP POLICY IF EXISTS "barbers: owner all" ON public.barbers;
CREATE POLICY "barbers: owner all"
  ON public.barbers FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );

-- clients
DROP POLICY IF EXISTS "clients: owner all" ON public.clients;
CREATE POLICY "clients: owner all"
  ON public.clients FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );

-- appointments
DROP POLICY IF EXISTS "appointments: owner all" ON public.appointments;
CREATE POLICY "appointments: owner all"
  ON public.appointments FOR ALL
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = auth.uid()
    )
  );

-- reminders: scoped via appointments -> salons -> auth.uid() (no direct salon_id column).
DROP POLICY IF EXISTS "reminders: owner all" ON public.reminders;
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
