/**
 * app/privacy/page.tsx
 *
 * Privacy Policy page for Noshowly.
 * Design: "Calm Professional" palette — #FAFAF8 background, Playfair Display
 * headings, Montserrat body, forest green #1B4332 accent.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import LandingNav from '@/components/landing/LandingNav';
import LandingFooter from '@/components/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy - Noshowly',
  description: 'How Noshowly collects, uses, and protects your data.',
};

/**
 * Renders one content section with a Playfair heading and body text.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-8 border-b border-[#E5E2DB] last:border-0">
      <h2 className="font-heading text-xl font-bold text-[#1A1A1A] mb-4">{title}</h2>
      <div className="space-y-3 text-[#4A4540] leading-relaxed font-body">{children}</div>
    </section>
  );
}

/**
 * Privacy Policy page.
 *
 * @returns The full privacy policy page with shared nav and footer.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] font-body text-[#1A1A1A]">

      <LandingNav />

      {/* Page hero */}
      <div className="bg-white border-b border-[#E5E2DB]">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#1B4332] mb-4 font-body">
            Legal
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-[#1A1A1A] leading-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-[#8A8680] font-body">
            Last updated: April 2026
          </p>
          <p className="mt-3 text-[#4A4540] font-body">
            Questions about this policy? Email us at{' '}
            <a
              href="mailto:noshowly@gmail.com"
              className="text-[#1B4332] underline underline-offset-2 hover:text-[#16392A] transition-colors"
            >
              noshowly@gmail.com
            </a>
            .
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-12">

        <Section title="What we collect">
          <p>
            We collect your name, email address, business name, and timezone when you create an account.
          </p>
          <p>
            When you add appointments, you enter client names, phone numbers, and optionally email
            addresses. We store this information to send reminders on your behalf. Your clients
            never create a Noshowly account. We do not market to them or share their data.
          </p>
          <p>
            We collect basic usage data such as page visits and error logs to fix bugs and improve
            the product.
          </p>
        </Section>

        <Section title="Why we collect it">
          <p>
            We use your data to run the Noshowly service, send appointment reminders to your
            clients, and fix bugs.
          </p>
          <p>We do not sell your data. We do not use it for advertising.</p>
        </Section>

        <Section title="Who we share it with">
          <p>
            We share data with a small number of services needed to run Noshowly.
          </p>
          <p>
            <strong className="text-[#1A1A1A] font-semibold">Twilio</strong>{' '}receives your
            client&apos;s phone number and the reminder message text to deliver SMS reminders.
          </p>
          <p>
            <strong className="text-[#1A1A1A] font-semibold">Resend</strong>{' '}receives your
            client&apos;s email address and the reminder content to deliver email reminders.
          </p>
          <p>We do not share your data with anyone else.</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your data for as long as your account is active. If you cancel, your data is
            kept for 30 days in case you change your mind. After 30 days, your account and all
            associated data is permanently deleted.
          </p>
        </Section>

        <Section title="Deleting your account">
          <p>
            You can delete your account at any time from the dashboard settings. All your data,
            including client records and appointment history, will be permanently deleted within
            30 days.
          </p>
          <p>
            You can also email us at{' '}
            <a
              href="mailto:noshowly@gmail.com"
              className="text-[#1B4332] underline underline-offset-2 hover:text-[#16392A] transition-colors"
            >
              noshowly@gmail.com
            </a>{' '}
            and we will handle it for you.
          </p>
        </Section>

        <Section title="Security">
          <p>
            All connections use HTTPS. Passwords are hashed and we cannot see them. Your business
            data is isolated at the database level so no other account can access it.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we make meaningful changes to how we handle your data, we will email you before the
            changes take effect. The date at the top of this page will also be updated.
          </p>
        </Section>

        {/* Bottom nav */}
        <div className="mt-12 pt-8 flex flex-wrap gap-6 text-sm">
          <Link href="/" className="text-[#8A8680] hover:text-[#1A1A1A] transition-colors font-body">
            Home
          </Link>
          <Link href="/terms" className="text-[#8A8680] hover:text-[#1A1A1A] transition-colors font-body">
            Terms of Service
          </Link>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
