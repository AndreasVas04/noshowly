/**
 * app/page.tsx
 *
 * Public landing page for Noshowly.
 *
 * Authenticated users are redirected to /dashboard before any content is sent
 * to the browser. Unauthenticated visitors see the full marketing page.
 *
 * Server Component — no client-side JS needed for the page body.
 * The LandingNav child is a Client Component to handle the mobile menu toggle.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Check, X, Globe, Bell, CheckCircle } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import LandingNav from '@/components/landing/LandingNav';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Noshowly: Stop Losing Money to No-Shows',
  description:
    'Noshowly automatically sends appointment reminders before every booking. Clients confirm or cancel via SMS or email. Flat monthly fee, zero commissions.',
};

/**
 * LandingPage renders the public marketing page or redirects authenticated
 * users straight to /dashboard.
 *
 * @returns The landing page JSX.
 */
export default async function LandingPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Authenticated users skip the landing page entirely.
  if (session) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-white font-body text-[#1A1A1A]">
      <LandingNav />

      {/* ======================================================================
          HERO
      ====================================================================== */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
        <p className="inline-block text-xs font-semibold tracking-widest uppercase text-[#C8C8C8] mb-6">
          Appointment Reminders
        </p>
        <h1 className="font-heading text-5xl md:text-6xl lg:text-7xl font-bold text-[#1A1A1A] leading-tight tracking-tight mb-6">
          Stop losing money
          <br />
          to no-shows.
        </h1>
        <p className="text-lg md:text-xl text-[#C8C8C8] max-w-2xl mx-auto mb-10 leading-relaxed">
          Noshowly automatically reminds your clients before every appointment.
          They confirm or cancel. You always know who is coming.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="h-12 px-8 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors inline-flex items-center"
          >
            Start free trial
          </Link>
          <a
            href="#features"
            className="h-12 px-8 border border-[#C8C8C8] hover:border-[#1A1A1A] text-[#1A1A1A] text-sm font-semibold rounded-lg transition-colors inline-flex items-center"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* ======================================================================
          SOCIAL PROOF BAR
      ====================================================================== */}
      <section className="border-y border-[#C8C8C8]/40 bg-[#F9F9F9]">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left">
          <span className="text-sm font-semibold text-[#1A1A1A]">
            Trusted by service businesses in 10+ countries
          </span>
          <span className="hidden sm:block text-[#C8C8C8]">·</span>
          <span className="text-sm text-[#C8C8C8]">
            Dentists, physiotherapists, salons, consultants, and more
          </span>
        </div>
      </section>

      {/* ======================================================================
          FEATURES
      ====================================================================== */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
            Everything you need to run your schedule.
          </h2>
          <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
            Set it up once. Noshowly handles reminders, confirmations, and
            bookings automatically from then on.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Feature 1 */}
          <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white">
            <div className="w-10 h-10 bg-[#1A1A1A]/5 rounded-xl flex items-center justify-center mb-5">
              <Globe className="h-5 w-5 text-[#1A1A1A]" aria-hidden="true" />
            </div>
            <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
              Online Booking Page
            </h3>
            <p className="text-sm text-[#C8C8C8] leading-relaxed">
              Clients book directly from your custom link. Add it to your Google
              profile, Instagram bio, or anywhere. No app download required.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white">
            <div className="w-10 h-10 bg-[#1A1A1A]/5 rounded-xl flex items-center justify-center mb-5">
              <Bell className="h-5 w-5 text-[#1A1A1A]" aria-hidden="true" />
            </div>
            <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
              SMS and Email Reminders
            </h3>
            <p className="text-sm text-[#C8C8C8] leading-relaxed">
              Automatic reminders sent 24 hours before every appointment. No
              manual work. No forgotten clients. Runs entirely in the background.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white">
            <div className="w-10 h-10 bg-[#1A1A1A]/5 rounded-xl flex items-center justify-center mb-5">
              <CheckCircle className="h-5 w-5 text-[#1A1A1A]" aria-hidden="true" />
            </div>
            <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
              YES / NO Confirmation
            </h3>
            <p className="text-sm text-[#C8C8C8] leading-relaxed">
              Clients reply YES or NO. Your dashboard updates instantly. You
              always know exactly who is showing up and who cancelled.
            </p>
          </div>
        </div>
      </section>

      {/* ======================================================================
          WHY NOSHOWLY — comparison vs Fresha
      ====================================================================== */}
      <section className="bg-[#F9F9F9] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-14">
            <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
              Why not just use Fresha?
            </h2>
            <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
              Fresha charges a 20% commission on every new client it sends you.
              Noshowly never touches your revenue.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full max-w-3xl mx-auto border-collapse text-sm">
              <thead>
                <tr>
                  <th className="py-4 px-6 text-left text-[#C8C8C8] font-medium w-1/2" />
                  <th className="py-4 px-6 text-center font-semibold text-[#1A1A1A]">
                    Fresha
                  </th>
                  <th className="py-4 px-6 text-center font-semibold text-[#1A1A1A] bg-[#1A1A1A] text-white rounded-t-xl">
                    Noshowly
                  </th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow
                  label="Commission on new clients"
                  fresha="20% per booking"
                  noshowly="None"
                  freshaOk={false}
                  noshowlyOk={true}
                />
                <ComparisonRow
                  label="Monthly cost"
                  fresha="Varies with volume"
                  noshowly="Flat fee from $19"
                  freshaOk={false}
                  noshowlyOk={true}
                />
                <ComparisonRow
                  label="Interferes with your payments"
                  fresha="Yes"
                  noshowly="Never"
                  freshaOk={false}
                  noshowlyOk={true}
                />
                <ComparisonRow
                  label="Works with your existing setup"
                  fresha="Requires migration"
                  noshowly="Add it alongside anything"
                  freshaOk={false}
                  noshowlyOk={true}
                  last
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ======================================================================
          PRICING
      ====================================================================== */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center mb-14">
          <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
            Simple, flat pricing.
          </h2>
          <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
            No commissions. No per-booking fees. One flat monthly price,
            regardless of how many clients you serve.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Starter */}
          <PricingCard
            name="Starter"
            price={19}
            description="Email reminders and online booking. Everything you need to get started."
            features={[
              'Unlimited email reminders',
              'Online booking page',
              'Appointment dashboard',
              'Client management',
              'YES / NO email confirmations',
            ]}
            featured={false}
          />

          {/* Professional */}
          <PricingCard
            name="Professional"
            price={39}
            description="Add SMS reminders for clients who prefer a text over an email."
            features={[
              'Everything in Starter',
              '300 SMS reminders per month',
              'YES / NO SMS confirmations',
              'SMS reply tracking',
              'Email + SMS combined',
            ]}
            featured={true}
          />

          {/* Business */}
          <PricingCard
            name="Business"
            price={79}
            description="For busy businesses sending a high volume of reminders every month."
            features={[
              'Everything in Professional',
              '1,000 SMS reminders per month',
              'Priority support',
            ]}
            featured={false}
          />
        </div>

        <p className="mt-8 text-center text-sm text-[#C8C8C8]">
          All plans include unlimited email reminders and a 14-day free trial.
          No credit card required to start.
        </p>
      </section>

      {/* ======================================================================
          CTA SECTION
      ====================================================================== */}
      <section className="bg-[#1A1A1A] py-24">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="font-heading text-4xl md:text-5xl font-bold text-white mb-5">
            Ready to stop no-shows?
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            Set up in 5 minutes. No long-term contract. Cancel any time.
          </p>
          <Link
            href="/register"
            className="h-12 px-10 bg-white hover:bg-[#F9F9F9] text-[#1A1A1A] text-sm font-semibold rounded-lg transition-colors inline-flex items-center"
          >
            Start your free trial
          </Link>
        </div>
      </section>

      {/* ======================================================================
          FOOTER
      ====================================================================== */}
      <footer className="border-t border-[#C8C8C8]/40 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Image src="/Logo.png" alt="Noshowly" width={120} height={30} className="h-6 w-auto" />
            <span className="text-xs text-[#C8C8C8]">
              &copy; {new Date().getFullYear()} Noshowly. All rights reserved.
            </span>
          </div>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link href="/login" className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
              Sign in
            </Link>
            <a href="#pricing" className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
              Pricing
            </a>
            <Link href="/privacy" className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// =============================================================================
// Sub-components (colocated — used only by this page)
// =============================================================================

/** Props for a single comparison table row. */
interface ComparisonRowProps {
  label: string;
  fresha: string;
  noshowly: string;
  freshaOk: boolean;
  noshowlyOk: boolean;
  last?: boolean;
}

/**
 * Renders one row of the Fresha vs Noshowly comparison table.
 *
 * @param props - Row label, cell values, and icon states.
 * @returns A table row JSX element.
 */
function ComparisonRow({ label, fresha, noshowly, freshaOk, noshowlyOk, last }: ComparisonRowProps) {
  const borderClass = last ? '' : 'border-b border-[#C8C8C8]/30';

  return (
    <tr className={borderClass}>
      <td className={`py-4 px-6 text-[#1A1A1A] font-medium ${borderClass}`}>{label}</td>
      <td className={`py-4 px-6 text-center ${borderClass}`}>
        <span className="flex items-center justify-center gap-2 text-[#C8C8C8]">
          {freshaOk ? (
            <Check className="h-4 w-4 text-green-500 shrink-0" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          )}
          {fresha}
        </span>
      </td>
      <td className={`py-4 px-6 text-center bg-[#1A1A1A] ${last ? 'rounded-b-xl' : ''}`}>
        <span className="flex items-center justify-center gap-2 text-white/90">
          {noshowlyOk ? (
            <Check className="h-4 w-4 text-green-400 shrink-0" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          )}
          {noshowly}
        </span>
      </td>
    </tr>
  );
}

/** Props for a pricing plan card. */
interface PricingCardProps {
  name: string;
  price: number;
  description: string;
  features: string[];
  featured: boolean;
}

/**
 * Renders a single pricing plan card.
 *
 * @param props - Plan name, price, description, features list, and featured flag.
 * @returns A styled plan card with a CTA button.
 */
function PricingCard({ name, price, description, features, featured }: PricingCardProps) {
  return (
    <div
      className={`rounded-2xl p-8 flex flex-col ${
        featured
          ? 'bg-[#1A1A1A] text-white ring-2 ring-[#1A1A1A]'
          : 'bg-white border border-[#C8C8C8]/40 text-[#1A1A1A]'
      }`}
    >
      {featured && (
        <span className="text-xs font-semibold tracking-widest uppercase text-white/50 mb-4">
          Most popular
        </span>
      )}
      <h3
        className={`font-heading text-2xl font-bold mb-1 ${featured ? 'text-white' : 'text-[#1A1A1A]'}`}
      >
        {name}
      </h3>
      <div className="flex items-end gap-1 mb-4">
        <span
          className={`font-heading text-4xl font-bold ${featured ? 'text-white' : 'text-[#1A1A1A]'}`}
        >
          ${price}
        </span>
        <span className={`text-sm mb-1.5 ${featured ? 'text-white/50' : 'text-[#C8C8C8]'}`}>
          /month
        </span>
      </div>
      <p className={`text-sm mb-7 leading-relaxed ${featured ? 'text-white/60' : 'text-[#C8C8C8]'}`}>
        {description}
      </p>

      <ul className="space-y-3 flex-1 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check
              className={`h-4 w-4 mt-0.5 shrink-0 ${featured ? 'text-white/70' : 'text-[#1A1A1A]'}`}
              aria-hidden="true"
            />
            <span className={featured ? 'text-white/80' : 'text-[#1A1A1A]/80'}>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/register"
        className={`h-11 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center ${
          featured
            ? 'bg-white text-[#1A1A1A] hover:bg-[#F9F9F9]'
            : 'bg-[#1A1A1A] text-white hover:bg-[#2D2D2D]'
        }`}
      >
        Get started
      </Link>
    </div>
  );
}
