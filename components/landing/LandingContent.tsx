/**
 * components/landing/LandingContent.tsx
 *
 * Client component containing all public landing page sections:
 * Hero, Social proof bar, Features, Comparison table, Pricing, CTA, Footer.
 *
 * Extracted from app/page.tsx so the Server Component stays minimal.
 * Uses Framer Motion for scroll-triggered fade-in animations.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  Globe,
  Bell,
  CheckCircle,
  Check,
  X,
  Scissors,
  Stethoscope,
  Dumbbell,
  Briefcase,
} from 'lucide-react';

// =============================================================================
// FadeIn wrapper — reusable scroll-triggered entrance animation
// =============================================================================

/**
 * Wraps children in a Framer Motion div that fades in when scrolled into view.
 *
 * @param children - Content to animate.
 * @param delay    - Optional delay in seconds before the animation starts.
 * @param className - Optional Tailwind classes applied to the wrapper.
 */
function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// =============================================================================
// ComparisonRow — one row of the Fresha vs Noshowly table
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
 * @param props - Row label, cell values, icon states.
 * @returns A table row JSX element.
 */
function ComparisonRow({
  label,
  fresha,
  noshowly,
  freshaOk,
  noshowlyOk,
  last,
}: ComparisonRowProps) {
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
      <td className={`py-4 px-6 text-center bg-[#6366F1]/5 ${last ? 'rounded-b-xl' : ''}`}>
        <span className="flex items-center justify-center gap-2 text-[#1A1A1A]/90">
          {noshowlyOk ? (
            <Check className="h-4 w-4 text-[#6366F1] shrink-0" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          )}
          {noshowly}
        </span>
      </td>
    </tr>
  );
}

// =============================================================================
// PricingCard — a single plan on the landing page
// =============================================================================

/** Props for a landing-page pricing plan card. */
interface PricingCardProps {
  name: string;
  price: number;
  description: string;
  features: string[];
  featured: boolean;
}

/**
 * Renders a single pricing plan card on the landing page.
 * The featured (Professional) card uses indigo ring and badge.
 *
 * @param props - Plan name, price, description, features list, and featured flag.
 * @returns A styled plan card with a CTA link.
 */
function PricingCard({ name, price, description, features, featured }: PricingCardProps) {
  return (
    <div
      className={[
        'rounded-2xl p-8 flex flex-col hover:-translate-y-1 hover:shadow-lg transition-all duration-200',
        featured
          ? 'bg-white text-[#1A1A1A] ring-2 ring-[#6366F1]'
          : 'bg-white border border-[#C8C8C8]/40 text-[#1A1A1A]',
      ].join(' ')}
    >
      {featured && (
        <span className="text-xs font-semibold tracking-widest uppercase bg-[#6366F1] text-white rounded-full px-3 py-1 self-start mb-4">
          Most popular
        </span>
      )}
      <h3 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-1">{name}</h3>
      <div className="flex items-end gap-1 mb-4">
        <span className="font-heading text-4xl font-bold text-[#1A1A1A]">${price}</span>
        <span className="text-sm mb-1.5 text-[#C8C8C8]">/month</span>
      </div>
      <p className="text-sm mb-7 leading-relaxed text-[#C8C8C8]">{description}</p>

      <ul className="space-y-3 flex-1 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check
              className={`h-4 w-4 mt-0.5 shrink-0 ${featured ? 'text-[#6366F1]' : 'text-[#1A1A1A]'}`}
              aria-hidden="true"
            />
            <span className="text-[#1A1A1A]/80">{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/register"
        className={[
          'h-11 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center',
          featured
            ? 'bg-[#6366F1] hover:bg-[#4F46E5] text-white'
            : 'bg-[#1A1A1A] text-white hover:bg-[#2D2D2D]',
        ].join(' ')}
      >
        Get started
      </Link>
    </div>
  );
}

// =============================================================================
// LandingContent — main export
// =============================================================================

/**
 * LandingContent renders all sections of the public landing page.
 * Extracted as a Client Component to support Framer Motion animations.
 *
 * @returns All landing page sections as a React fragment.
 */
export default function LandingContent() {
  return (
    <>
      {/* ====================================================================
          HERO
      ==================================================================== */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-gradient-to-b from-white via-white to-[#EEF2FF] pt-20 pb-24 px-6 text-center"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold tracking-widest uppercase text-[#6366F1] mb-6">
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

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="h-12 px-8 bg-[#6366F1] hover:bg-[#4F46E5] text-white text-sm font-semibold rounded-lg transition-all duration-200 hover:scale-[1.02] inline-flex items-center"
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

          {/* Floating hero visual mockup */}
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="mt-16 mx-auto max-w-sm"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-[#C8C8C8]/20 overflow-hidden">
              {/* Dark header */}
              <div className="bg-[#1A1A1A] px-5 py-3.5 flex items-center justify-between">
                <span className="text-white text-sm font-semibold">Today · 4 appointments</span>
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                </div>
              </div>
              {/* Mock appointment rows */}
              <div className="divide-y divide-[#C8C8C8]/15 px-5">
                {(
                  [
                    { time: '09:00', name: 'Sarah M.', status: 'Confirmed', color: '#10B981' },
                    { time: '10:30', name: 'James K.', status: 'Pending', color: '#F59E0B' },
                    { time: '14:00', name: 'Emma T.', status: 'Confirmed', color: '#10B981' },
                    { time: '16:30', name: 'Mike D.', status: 'Pending', color: '#F59E0B' },
                  ] as const
                ).map((row) => (
                  <div key={row.time} className="py-3 flex items-center gap-3">
                    <span className="text-xs font-semibold text-[#1A1A1A] w-10 tabular-nums shrink-0">
                      {row.time}
                    </span>
                    <span className="text-sm text-[#1A1A1A] flex-1 font-medium">{row.name}</span>
                    <span
                      className="flex items-center gap-1 text-xs font-medium"
                      style={{ color: row.color }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: row.color }}
                      />
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* ====================================================================
          SOCIAL PROOF BAR
      ==================================================================== */}
      <section className="border-y border-[#C8C8C8]/40 bg-[#F9F9F9]">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <FadeIn>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <span className="text-sm font-semibold text-[#1A1A1A]">
                Trusted by service businesses in 10+ countries
              </span>
              <span className="hidden sm:block text-[#C8C8C8]">·</span>
              <div className="flex items-center gap-4">
                <Scissors className="w-4 h-4 text-[#C8C8C8]" aria-hidden="true" />
                <Stethoscope className="w-4 h-4 text-[#C8C8C8]" aria-hidden="true" />
                <Dumbbell className="w-4 h-4 text-[#C8C8C8]" aria-hidden="true" />
                <Briefcase className="w-4 h-4 text-[#C8C8C8]" aria-hidden="true" />
              </div>
              <span className="text-sm text-[#C8C8C8]">
                Dentists, physiotherapists, salons, consultants, and more
              </span>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ====================================================================
          FEATURES
      ==================================================================== */}
      <section id="features" className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
              Everything you need to run your schedule.
            </h2>
            <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
              Set it up once. Noshowly handles reminders, confirmations, and bookings
              automatically from then on.
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            <FadeIn delay={0}>
              <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white hover:-translate-y-1 hover:shadow-lg transition-all duration-200 cursor-default">
                <div className="w-10 h-10 bg-[#EEF2FF] rounded-xl flex items-center justify-center mb-5">
                  <Globe className="h-5 w-5 text-[#6366F1]" aria-hidden="true" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
                  Online Booking Page
                </h3>
                <p className="text-sm text-[#C8C8C8] leading-relaxed">
                  Clients book directly from your custom link. Add it to your Google profile,
                  Instagram bio, or anywhere. No app download required.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white hover:-translate-y-1 hover:shadow-lg transition-all duration-200 cursor-default">
                <div className="w-10 h-10 bg-[#EEF2FF] rounded-xl flex items-center justify-center mb-5">
                  <Bell className="h-5 w-5 text-[#6366F1]" aria-hidden="true" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
                  SMS and Email Reminders
                </h3>
                <p className="text-sm text-[#C8C8C8] leading-relaxed">
                  Automatic reminders sent 24 hours before every appointment. No manual work. No
                  forgotten clients. Runs entirely in the background.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="rounded-2xl border border-[#C8C8C8]/40 p-8 bg-white hover:-translate-y-1 hover:shadow-lg transition-all duration-200 cursor-default">
                <div className="w-10 h-10 bg-[#EEF2FF] rounded-xl flex items-center justify-center mb-5">
                  <CheckCircle className="h-5 w-5 text-[#6366F1]" aria-hidden="true" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-[#1A1A1A] mb-3">
                  YES / NO Confirmation
                </h3>
                <p className="text-sm text-[#C8C8C8] leading-relaxed">
                  Clients reply YES or NO. Your dashboard updates instantly. You always know
                  exactly who is showing up and who cancelled.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ====================================================================
          WHY NOSHOWLY — comparison vs Fresha
      ==================================================================== */}
      <section className="bg-[#F9F9F9] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
              Why not just use Fresha?
            </h2>
            <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
              Fresha charges a 20% commission on every new client it sends you. Noshowly never
              touches your revenue.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="overflow-x-auto">
              <table className="w-full max-w-3xl mx-auto border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="py-4 px-6 text-left text-[#C8C8C8] font-medium w-1/2" />
                    <th className="py-4 px-6 text-center font-semibold text-[#1A1A1A]">Fresha</th>
                    <th className="py-4 px-6 text-center font-semibold text-white bg-[#6366F1] rounded-t-xl">
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
          </FadeIn>
        </div>
      </section>

      {/* ====================================================================
          PRICING
      ==================================================================== */}
      <section id="pricing" className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="font-heading text-4xl font-bold text-[#1A1A1A] mb-4">
              Simple, flat pricing.
            </h2>
            <p className="text-[#C8C8C8] text-base max-w-xl mx-auto">
              No commissions. No per-booking fees. One flat monthly price, regardless of how many
              clients you serve.
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            <FadeIn delay={0}>
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
            </FadeIn>

            <FadeIn delay={0.1}>
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
            </FadeIn>

            <FadeIn delay={0.2}>
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
            </FadeIn>
          </div>

          <p className="mt-8 text-center text-sm text-[#C8C8C8]">
            All plans include unlimited email reminders and a 14-day free trial. No credit card
            required to start.
          </p>
        </div>
      </section>

      {/* ====================================================================
          CTA SECTION
      ==================================================================== */}
      <section className="bg-[#1A1A1A] py-24 relative overflow-hidden">
        {/* Dot pattern background */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 text-center">
          <FadeIn>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-white mb-5">
              Ready to stop no-shows?
            </h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
              Set up in 5 minutes. No long-term contract. Cancel any time.
            </p>
            <Link
              href="/register"
              className="h-12 px-10 bg-[#6366F1] hover:bg-[#4F46E5] text-white text-sm font-semibold rounded-lg transition-all duration-200 hover:scale-[1.02] inline-flex items-center"
            >
              Start your free trial
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* ====================================================================
          FOOTER
      ==================================================================== */}
      <footer className="border-t border-[#C8C8C8]/40 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Image src="/Logo.png" alt="Noshowly" width={120} height={30} className="h-6 w-auto" />
            <span className="text-xs text-[#C8C8C8]">
              &copy; {new Date().getFullYear()} Noshowly. All rights reserved.
            </span>
          </div>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link
              href="/login"
              className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
            >
              Sign in
            </Link>
            <a
              href="#pricing"
              className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
            >
              Pricing
            </a>
            <Link
              href="/privacy"
              className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors"
            >
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
