<div align="center">
  <img src="public/Logo.png" alt="Noshowly" height="60" />
  <p><strong>Appointment scheduling and email reminder SaaS for service businesses</strong></p>

  🔗 [noshowly.vercel.app](https://noshowly.vercel.app)
</div>

## Demo Account

Explore the full dashboard with pre-filled data:

**Email:** demo@noshowly.com

**Password:** Demo1234!

The account includes sample staff, services, and bookings.

<div align="center">

  ![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)

  ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)

  ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)

  ![Resend](https://img.shields.io/badge/Resend-Email-000000)

  ![Stripe](https://img.shields.io/badge/Stripe-Billing-635BFF?logo=stripe)

  ![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel)
</div>

---

## Features

- **Public booking page** — shareable link with custom slug, headline, and description
- **Email reminders** — a booking confirmation right after each booking and a reminder 24 hours before the appointment, with customisable templates via Resend; dates and times are always in the business's timezone
- **YES/NO confirmation** — email buttons open a page where clients confirm or cancel (opening a link never changes anything); dashboard updates in real time
- **Appointment dashboard** — today view and week view with staff filtering and live status updates
- **Client management** — phone-deduped client records with notes and appointment history
- **Staff and services** — manage team members, service catalogue (name, duration, price), and per-staff availability
- **Stripe billing** — 14-day free trial without a card, then a monthly subscription (Basic plan) with Apple Pay and Google Pay support, managed and cancelled in the Stripe customer portal
- **Double-booking prevention** — server-side, duration-aware conflict checks for both clients and staff; the booking page only offers times that fit each staff member's hours, in the business's timezone

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (email/password) |
| Email | Resend |
| Payments | Stripe |
| Hosting | Vercel |
| Cron jobs | Supabase pg_cron (or Vercel Cron) |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/AndreasVas04/noshowly.git
cd noshowly
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file at the project root and fill in your values. See the [Environment Variables](#environment-variables) section for the full list.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Run the tests

```bash
npm test
```

Unit tests (Vitest) cover the timezone, scheduling, client de-duplication, reminder email, plan and billing helpers in `lib/`.

---

## Environment Variables

All secrets are stored in `.env.local` and are never committed to version control.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Resend
RESEND_API_KEY=
# Sender address on a domain verified in Resend, e.g. reminders@example.com
RESEND_FROM_ADDRESS=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_BASIC_PRICE_ID=
# Optional: prices of the internal Pro and Business plans, if any subscription uses them
STRIPE_PRO_PRICE_ID=
STRIPE_BUSINESS_PRICE_ID=

# App
# Absolute URL of the app, used for the links in emails
NEXT_PUBLIC_APP_URL=
# Required by /api/cron/send-reminders
CRON_SECRET=
```

---

## Reminder Emails

`/api/cron/send-reminders` sends the 24-hour reminders that are due. Schedule it every 15 minutes, either as a Supabase pg_cron job (`POST` with an `X-Cron-Secret: <CRON_SECRET>` header) or as a Vercel Cron job (`GET`; Vercel sends `Authorization: Bearer <CRON_SECRET>`). A missed run is caught up by the next one.

- **Booking confirmation**, right after a booking: with YES/NO buttons for appointments created in the dashboard, a "your appointment has been booked" notice for public bookings.
- **24-hour reminder** with YES/NO buttons, for appointments still awaiting confirmation. It is held back until 12 hours after a booking confirmation, so a client never gets both minutes apart.
- **Test email** from the appointment's "Send reminder" button, marked as a test; its buttons never change anything.

Every email goes through `lib/reminders/gateway.ts`, which applies the plan and usage checks and the anti-abuse limits, and records each email in the `reminders` table before sending it. A reminder that fails to send is retried by later runs, at most 3 times in 24 hours; an email the provider rejects as invalid (for example the address) is not retried. If the provider refuses the account itself (API key, sender domain, quota), the run stops and the reminders stay due.

---

## Trial and Billing

Every new account starts on a 14-day free trial (`users.trial_ends_at`) with full access and a small monthly email allowance. When the trial ends, or a subscription is no longer active, the account becomes read-only: data and settings stay visible and business settings can still be saved, but staff, services, availability, clients, appointments and the booking page cannot be changed, no emails are sent, and the public booking page stops taking bookings. The rules are in `lib/entitlements.ts`.

The Basic plan is sold with Stripe Checkout and managed in the Stripe customer portal (Settings → Billing → Manage billing). `/api/webhooks/stripe` keeps `users.plan` up to date: on every event it reads all of the customer's subscriptions from Stripe and derives the plan from them, so the order of events and retries do not matter. A `past_due` subscription keeps its plan while Stripe retries the payment.

Stripe setup, in test and in live mode:

- **Webhook** to `https://<your app>/api/webhooks/stripe` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. Its signing secret is `STRIPE_WEBHOOK_SECRET`.
- **Customer portal** (Settings → Billing → Customer portal): turn it on and allow customers to update payment methods, see invoices and cancel subscriptions (at the end of the billing period).
- **Failed payments** (Settings → Billing → Subscriptions and emails → manage failed payments): after the last retry, cancel the subscription or mark it unpaid, so an unpaid account ends up read-only.

---

## Project Structure

```
noshowly/
├── app/                  # Next.js App Router pages and API routes
│   ├── api/              # REST API endpoints
│   ├── book/[slug]/      # Public booking page
│   ├── dashboard/        # Authenticated dashboard (today, week, booking, settings)
│   ├── login/            # Sign-in page
│   ├── pricing/          # Pricing + Stripe Checkout
│   └── register/         # Registration page
├── components/           # Shared UI components
├── lib/                  # Supabase clients, Resend, Stripe, plans config
├── supabase/             # Database schema and migration files
└── types/                # TypeScript types for all DB tables
```

---

## License

This project is not open-source. All rights reserved.

---

*Built as a portfolio project by Andreas Vasileiou*
