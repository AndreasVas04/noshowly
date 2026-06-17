/**
 * components/landing/LandingContent.tsx
 *
 * Client component containing all public landing page sections:
 * Hero, Social proof, Features (alternating), Comparison, Pricing, CTA, Footer.
 *
 * Design direction: "The Calm Professional" — warm off-white (#FAFAF8),
 * deep forest green (#1B4332) accent, editorial typography, no floating mockups.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import LandingFooter from '@/components/landing/LandingFooter';

// =============================================================================
// FadeIn — reusable scroll-triggered entrance animation
// =============================================================================

/**
 * Wraps children in a Framer Motion div that fades in when scrolled into view.
 *
 * @param children - Content to animate.
 * @param delay    - Optional delay in seconds.
 * @param className - Optional Tailwind classes.
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
// ComparisonRow — one row of the "Others vs Noshowly" table
// =============================================================================

interface ComparisonRowProps {
  label: string;
  others: string;
  noshowly: string;
  othersOk: boolean;
  noshowlyOk: boolean;
  last?: boolean;
}

/**
 * Renders one row of the Others vs Noshowly comparison table.
 *
 * @param props - Row label, cell values, icon states.
 */
function ComparisonRow({ label, others, noshowly, othersOk, noshowlyOk, last }: ComparisonRowProps) {
  const borderClass = last ? '' : 'border-b border-[#E5E2DB]';

  return (
    <tr className={borderClass}>
      <td className={`py-4 px-6 text-[#1A1A1A] font-medium text-sm ${borderClass}`}>{label}</td>
      <td className={`py-4 px-6 text-center ${borderClass}`}>
        <span className="flex items-center justify-center gap-2 text-[#8A8680] text-sm">
          {othersOk ? (
            <Check className="h-4 w-4 text-[#8A8680] shrink-0" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
          )}
          {others}
        </span>
      </td>
      <td className={`py-4 px-6 text-center bg-[#1B4332]/[0.04] ${last ? 'rounded-b-xl' : ''}`}>
        <span className="flex items-center justify-center gap-2 text-[#1A1A1A] text-sm font-medium">
          {noshowlyOk ? (
            <Check className="h-4 w-4 text-[#1B4332] shrink-0" aria-hidden="true" />
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

interface PricingCardProps {
  name: string;
  price: number;
  description: string;
  features: string[];
  featured: boolean;
}

/**
 * Renders a single pricing plan card on the landing page.
 * The featured (Professional) card uses a dark forest green design.
 *
 * @param props - Plan name, price, description, features list, and featured flag.
 */
function PricingCard({ name, price, description, features, featured }: PricingCardProps) {
  if (featured) {
    return (
      <div className="rounded-2xl p-8 flex flex-col h-full bg-[#1B4332] text-white relative">
        <h3 className="font-heading text-2xl font-bold mb-1">{name}</h3>
        <div className="flex items-end gap-1 mb-4">
          <span className="font-heading text-4xl font-bold">${price}</span>
          <span className="text-sm mb-1.5 text-white/60">/month</span>
        </div>
        <p className="text-sm mb-7 leading-relaxed text-white/70 font-body">{description}</p>

        <ul className="space-y-3 flex-1 mb-8">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm font-body">
              <Check className="h-4 w-4 mt-0.5 shrink-0 text-[#86EFAC]" aria-hidden="true" />
              <span className="text-white/85">{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href="/register"
          className="h-11 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center bg-white text-[#1B4332] hover:bg-[#E8F2EC] font-body"
        >
          Get started
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-8 flex flex-col h-full bg-white border border-[#E8E4DC] text-[#1A1A1A] hover:-translate-y-1 hover:shadow-lg transition-all duration-200">
      <h3 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-1">{name}</h3>
      <div className="flex items-end gap-1 mb-4">
        <span className="font-heading text-4xl font-bold text-[#1A1A1A]">${price}</span>
        <span className="text-sm mb-1.5 text-[#8A8680]">/month</span>
      </div>
      <p className="text-sm mb-7 leading-relaxed text-[#8A8680] font-body">{description}</p>

      <ul className="space-y-3 flex-1 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm font-body">
            <Check className="h-4 w-4 mt-0.5 shrink-0 text-[#1B4332]" aria-hidden="true" />
            <span className="text-[#1A1A1A]/80">{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/register"
        className="h-11 rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center bg-[#1A1A1A] text-white hover:bg-[#2D2D2D] font-body"
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
 *
 * @returns All landing page sections as a React fragment.
 */
export default function LandingContent() {
  return (
    <>
      {/* ====================================================================
          HERO
      ==================================================================== */}
      <section
        className="bg-[#FAFAF8] pt-20 pb-24 px-6"
        style={{
          backgroundImage: 'radial-gradient(circle, #D8D4CC 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="lg:grid lg:grid-cols-2 lg:gap-20 lg:items-center">

            {/* Copy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="pb-14 lg:pb-0"
            >
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#1B4332] mb-6 font-body">
                Appointment reminders for service businesses
              </p>
              <h1 className="font-heading text-5xl md:text-6xl lg:text-[4rem] font-bold text-[#1A1A1A] leading-[1.06] tracking-tight mb-7">
                Your 3pm just<br />cancelled.<br />Again.
              </h1>
              <p className="text-lg text-[#8A8680] leading-relaxed mb-10 max-w-lg font-body">
                Noshowly automatically sends reminders before every appointment.
                Clients reply YES or NO. You always know who is coming in.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center h-12 px-8 bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-semibold rounded-lg transition-colors font-body"
                >
                  Get started
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center h-12 px-8 border border-[#C8C4BC] hover:border-[#1A1A1A] text-[#1A1A1A] text-sm font-semibold rounded-lg transition-colors font-body"
                >
                  See how it works
                </a>
              </div>
            </motion.div>

            {/* Visual: appointment reminder card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
              className="hidden lg:block"
            >
              <div className="relative">
                <div className="bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.09)] border border-[#E8E4DC] p-6 max-w-[360px] mx-auto">

                  {/* Card header */}
                  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#F0EDE8]">
                    <div className="w-9 h-9 rounded-full bg-[#E8F2EC] flex items-center justify-center shrink-0">
                      <span className="text-[#1B4332] text-xs font-bold font-body">CH</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A1A] font-body">City Hair Salon</p>
                      <p className="text-xs text-[#8A8680] font-body">Email Reminder</p>
                    </div>
                    <div className="ml-auto w-2 h-2 rounded-full bg-[#1B4332]" />
                  </div>

                  {/* Message */}
                  <p className="text-sm text-[#1A1A1A] leading-relaxed font-body mb-5 bg-[#F5F2ED] rounded-xl p-4">
                    Hi Sarah! Reminder from City Hair Salon: your{' '}
                    <span className="font-semibold">Haircut</span> is tomorrow at{' '}
                    <span className="font-semibold">3:00 PM</span>. Click{' '}
                    <span className="font-semibold">YES</span> to confirm or{' '}
                    <span className="font-semibold">NO</span> to cancel.
                  </p>

                  {/* Buttons */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="flex items-center justify-center gap-2 h-10 rounded-lg bg-[#1B4332] text-white text-sm font-semibold font-body">
                      <span>YES</span>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="flex items-center justify-center gap-2 h-10 rounded-lg border border-[#E8E4DC] text-[#8A8680] text-sm font-semibold font-body">
                      <span>NO</span>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  </div>

                  {/* Confirmation status */}
                  <div className="flex items-center justify-center gap-1.5 text-xs text-[#1B4332] font-medium font-body">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Appointment confirmed
                  </div>
                </div>

                {/* Decorative background card */}
                <div className="absolute -bottom-3 -right-3 w-48 h-20 bg-[#E8F2EC] rounded-2xl -z-10 opacity-70" />
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ====================================================================
          SOCIAL PROOF BAR
      ==================================================================== */}
      <section className="border-y border-[#E5E2DB] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <FadeIn>
            <p className="text-center text-sm text-[#8A8680] font-body">
              Used by salons, clinics, physiotherapists and consultants
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ====================================================================
          FEATURES — alternating layout with section numbers
      ==================================================================== */}
      <section id="features" className="bg-[#FAFAF8] py-24">
        <div className="mx-auto max-w-6xl px-6">

          <FadeIn className="mb-16">
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#1B4332] mb-4 font-body">
              How it works
            </p>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-[#1A1A1A] max-w-xl leading-[1.1]">
              Set it up once. It runs forever.
            </h2>
          </FadeIn>

          {/* 01 — Reminders */}
          <FadeIn>
            <div className="lg:grid lg:grid-cols-2 lg:gap-24 items-center py-14 border-t border-[#E5E2DB]">
              <div>
                <span
                  className="font-heading font-bold text-[#E8F2EC] leading-none block mb-0"
                  style={{ fontSize: '8rem', lineHeight: 0.85 }}
                  aria-hidden="true"
                >
                  01
                </span>
                <h3 className="font-heading text-3xl font-bold text-[#1A1A1A] mt-4 mb-4">
                  Reminders that actually get read.
                </h3>
                <p className="text-base text-[#8A8680] leading-relaxed font-body">
                  Noshowly sends an email reminder before every appointment, automatically.
                  No manual work. No forgotten clients. It runs entirely in the background
                  from the moment you add an appointment.
                </p>
              </div>
              <div className="hidden lg:block">
                <div className="bg-white rounded-2xl border border-[#E8E4DC] p-6 max-w-sm ml-auto shadow-sm">
                  <p className="text-xs text-[#8A8680] font-body mb-3 uppercase tracking-widest">
                    Email · Sent before your appointment
                  </p>
                  <div className="bg-[#F5F2ED] rounded-xl p-4">
                    <p className="text-sm text-[#1A1A1A] leading-relaxed font-body">
                      Hi Emma! Reminder from Grove Physio: your{' '}
                      <strong>Physiotherapy session</strong> is tomorrow, Tuesday at{' '}
                      <strong>10:30 AM</strong>. Click YES to confirm or NO to cancel.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-xs text-[#8A8680] font-body">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1B4332]" />
                    Sent automatically by Noshowly
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* 02 — Confirmations */}
          <FadeIn>
            <div className="lg:grid lg:grid-cols-2 lg:gap-24 items-center py-14 border-t border-[#E5E2DB]">
              <div className="hidden lg:flex justify-start items-center order-first">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 bg-white border border-[#E8E4DC] rounded-xl px-5 py-4 w-72 shadow-sm">
                    <div className="w-9 h-9 rounded-lg bg-[#E8F2EC] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[#1B4332]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A1A] font-body">Sarah M. confirmed</p>
                      <p className="text-xs text-[#8A8680] font-body">Replied YES · 2:14 PM</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-white border border-[#E8E4DC] rounded-xl px-5 py-4 w-72 shadow-sm opacity-50">
                    <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A1A] font-body">James K. cancelled</p>
                      <p className="text-xs text-[#8A8680] font-body">Replied NO · 3:02 PM</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-white border border-[#E8E4DC] rounded-xl px-5 py-4 w-72 shadow-sm">
                    <div className="w-9 h-9 rounded-lg bg-[#E8F2EC] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[#1B4332]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A1A] font-body">Maria L. confirmed</p>
                      <p className="text-xs text-[#8A8680] font-body">Replied YES · 4:51 PM</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <span
                  className="font-heading font-bold text-[#E8F2EC] leading-none block mb-0"
                  style={{ fontSize: '8rem', lineHeight: 0.85 }}
                  aria-hidden="true"
                >
                  02
                </span>
                <h3 className="font-heading text-3xl font-bold text-[#1A1A1A] mt-4 mb-4">
                  One reply. That is all.
                </h3>
                <p className="text-base text-[#8A8680] leading-relaxed font-body">
                  Clients reply YES or NO to the reminder. Your dashboard updates the
                  moment they respond. You know who is coming and who has cancelled,
                  hours before the appointment. No phone tag. No back-and-forth.
                </p>
              </div>
            </div>
          </FadeIn>

          {/* 03 — Booking Page */}
          <FadeIn>
            <div className="lg:grid lg:grid-cols-2 lg:gap-24 items-center py-14 border-t border-[#E5E2DB]">
              <div>
                <span
                  className="font-heading font-bold text-[#E8F2EC] leading-none block mb-0"
                  style={{ fontSize: '8rem', lineHeight: 0.85 }}
                  aria-hidden="true"
                >
                  03
                </span>
                <h3 className="font-heading text-3xl font-bold text-[#1A1A1A] mt-4 mb-4">
                  Your own booking page.
                </h3>
                <p className="text-base text-[#8A8680] leading-relaxed font-body">
                  Give clients a link to book themselves. Add it to your Google profile,
                  Instagram bio, or website. New appointments appear in your dashboard
                  immediately, with reminders scheduled automatically.
                </p>
              </div>
              <div className="hidden lg:block">
                <div className="bg-white rounded-2xl border border-[#E8E4DC] p-6 max-w-sm ml-auto shadow-sm">
                  <p className="text-xs text-[#8A8680] font-body mb-3 uppercase tracking-widest">
                    Your booking link
                  </p>
                  <div className="bg-[#F5F2ED] rounded-xl px-4 py-3 flex items-center justify-between gap-2 mb-5">
                    <span className="text-sm text-[#1A1A1A] font-body font-medium truncate">
                      noshowly.vercel.app/book/city-hair
                    </span>
                    <svg className="w-4 h-4 text-[#8A8680] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['Google Profile', 'Instagram Bio', 'Website'].map((tag) => (
                      <span key={tag} className="text-xs px-3 py-1.5 bg-[#E8F2EC] text-[#1B4332] rounded-full font-body font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-[#8A8680] font-body">
                    Clients book in under a minute. No app download required.
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>

        </div>
      </section>

      {/* ====================================================================
          COMPARISON — Booking platforms vs Noshowly
      ==================================================================== */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6">
          <FadeIn className="mb-14">
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#1B4332] mb-4 font-body">
              Why Noshowly
            </p>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-[#1A1A1A] mb-4 max-w-xl leading-[1.1]">
              Not another booking marketplace.
            </h2>
            <p className="text-base text-[#8A8680] max-w-xl font-body">
              Unlike marketplace-style booking platforms, Noshowly charges a flat monthly fee
              with zero commissions on your revenue.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="overflow-x-auto">
              <table className="w-full max-w-3xl mx-auto border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="py-4 px-6 text-left text-[#8A8680] font-medium w-1/2" />
                    <th className="py-4 px-6 text-center font-semibold text-[#1A1A1A] font-body">
                      Booking platforms
                    </th>
                    <th className="py-4 px-6 text-center font-semibold text-white bg-[#1B4332] rounded-t-xl font-body">
                      Noshowly
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow
                    label="Commissions on bookings"
                    others="Up to 20% or more"
                    noshowly="None, ever"
                    othersOk={false}
                    noshowlyOk={true}
                  />
                  <ComparisonRow
                    label="Monthly cost"
                    others="Varies with volume"
                    noshowly="Flat fee for $19"
                    othersOk={false}
                    noshowlyOk={true}
                  />
                  <ComparisonRow
                    label="Interferes with your payments"
                    others="Often"
                    noshowly="Never"
                    othersOk={false}
                    noshowlyOk={true}
                  />
                  <ComparisonRow
                    label="Works with your existing setup"
                    others="May require migration"
                    noshowly="Add it alongside anything"
                    othersOk={false}
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
      <section id="pricing" className="bg-[#FAFAF8] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <FadeIn className="mb-14">
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#1B4332] mb-4 font-body">
              Pricing
            </p>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-[#1A1A1A] mb-4 leading-[1.1]">
              Simple, flat pricing.
            </h2>
            <p className="text-base text-[#8A8680] max-w-xl font-body">
              No commissions. No per-booking fees. One flat monthly price,
              regardless of how many clients you serve.
            </p>
          </FadeIn>

          <FadeIn className="max-w-sm mx-auto w-full">
            <PricingCard
              name="Basic"
              price={19}
              description="Online booking and email reminders for service businesses."
              features={[
                'Online booking page',
                'Unlimited email reminders',
                'Email YES/NO confirmation buttons',
                'Client management',
                'Appointment management',
                'Flat monthly price',
              ]}
              featured={true}
            />
          </FadeIn>

          <p className="mt-8 text-center text-sm text-[#8A8680] font-body">
            No commissions. No per-booking fees. No credit card required to start.
          </p>
        </div>
      </section>

      {/* ====================================================================
          CTA SECTION
      ==================================================================== */}
      <section className="bg-[#1B4332] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 text-center">
          <FadeIn>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-white mb-5">
              Ready to stop the no-shows?
            </h2>
            <p className="text-white/65 text-lg max-w-xl mx-auto mb-10 font-body">
              Set up in 5 minutes. No long-term contract. Cancel any time.
            </p>
            <Link
              href="/register"
              className="h-12 px-10 bg-white hover:bg-[#E8F2EC] text-[#1B4332] text-sm font-semibold rounded-lg transition-colors inline-flex items-center font-body"
            >
              Get started
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* ====================================================================
          FOOTER
      ==================================================================== */}
      <LandingFooter />
    </>
  );
}
