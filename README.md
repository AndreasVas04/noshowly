<div align="center">
  <img src="public/Logo.png" alt="Noshowly" height="60" />
  <p><strong>Appointment scheduling and SMS/email reminder SaaS for service businesses</strong></p>

  ![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
  ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)
  ![Twilio](https://img.shields.io/badge/Twilio-SMS-F22F46?logo=twilio)
  ![Stripe](https://img.shields.io/badge/Stripe-Billing-635BFF?logo=stripe)
  ![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel)
</div>

---

## Features

- **Public booking page** — shareable link with custom slug, headline, and description
- **SMS reminders** — automated reminders sent 24 hours before each appointment via Twilio
- **Email reminders** — automated reminders sent 48 hours before with customisable templates via Resend
- **YES/NO confirmation** — clients confirm or cancel by replying to SMS or clicking email buttons; dashboard updates in real time
- **Appointment dashboard** — today view and week view with staff filtering and live status updates
- **Client management** — phone-deduped client records with notes and appointment history
- **Staff and services** — manage team members, service catalogue (name, duration, price), and per-staff availability
- **Stripe billing** — monthly subscription plans (Starter / Professional / Business) with Apple Pay and Google Pay support
- **Double-booking prevention** — server-side conflict checks within a 30-minute window for both clients and staff

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (email/password) |
| SMS | Twilio |
| Email | Resend |
| Payments | Stripe |
| Hosting | Vercel |
| Cron jobs | Supabase pg_cron |

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

---

## Environment Variables

All secrets are stored in `.env.local` and are never committed to version control.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Resend
RESEND_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_STARTER_PRICE_ID=
STRIPE_PROFESSIONAL_PRICE_ID=
STRIPE_BUSINESS_PRICE_ID=

# App
NEXT_PUBLIC_APP_URL=
CRON_SECRET=
```

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
├── lib/                  # Supabase clients, Twilio, Resend, Stripe, plans config
├── supabase/             # Database schema and migration files
└── types/                # TypeScript types for all DB tables
```

---

## License

This project is not open-source. All rights reserved.

---

*Built as a portfolio project by Andreas Vasiliou*
