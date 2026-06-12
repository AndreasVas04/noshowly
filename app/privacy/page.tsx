/**
 * app/privacy/page.tsx
 *
 * Privacy Policy page for Noshowly.
 * Design: "Calm Professional" — forest green hero banner (#1B4332), white content
 * card on #FAFAF8 warm off-white, Playfair Display headings, Montserrat body.
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
 * Renders one numbered content section with a Playfair heading and body text.
 *
 * @param number - Two-character section label, e.g. "01".
 * @param title - The section heading text.
 * @param children - Body content nodes.
 */
function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-9 border-b border-[#E5E2DB] last:border-0 last:pb-3">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#1B4332]/55 font-body shrink-0 select-none">
          {number}
        </span>
        <h2 className="font-heading text-xl font-semibold text-[#1A1A1A]">{title}</h2>
      </div>
      <div className="space-y-3 text-[#2D2D2D] leading-[1.85] font-body text-[15px]">
        {children}
      </div>
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

      {/* Forest green hero banner */}
      <div className="relative bg-[#1B4332] overflow-hidden">
        {/* Subtle dot pattern overlay — matches auth pages */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle, #D8D4CC 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 md:py-28">
          <p className="text-[10px] font-bold tracking-[0.4em] uppercase text-white/50 font-body mb-5">
            Legal
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-white leading-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-white/60 font-body text-sm tracking-wide">
            Last updated: April 2026
          </p>
          <div className="mt-7 w-10 h-px bg-white/25" />
          <p className="mt-6 text-white/65 font-body text-sm">
            Questions about this policy? Email us at{' '}
            <a
              href="mailto:noshowly@gmail.com"
              className="text-white/90 underline underline-offset-2 hover:text-white transition-colors"
            >
              noshowly@gmail.com
            </a>
            .
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {/* White content card — lifts the document off the warm background */}
        <div className="bg-white rounded-2xl border border-[#E5E2DB] shadow-sm px-8 md:px-12 py-2">

          <Section number="01" title="What we collect">
            <p>
              We collect your name, email address, business name, and timezone when you create an
              account.
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

          <Section number="02" title="Why we collect it">
            <p>
              We use your data to run the Noshowly service, send appointment reminders to your
              clients, and fix bugs.
            </p>
            <p>We do not sell your data. We do not use it for advertising.</p>
          </Section>

          <Section number="03" title="Who we share it with">
            <p>We share data with a small number of services needed to run Noshowly.</p>
            <p>
              <strong className="font-semibold text-[#1A1A1A]">Resend</strong>{' '}
              receives your client&apos;s email address and the reminder content to deliver email
              reminders.
            </p>
            <p>We do not share your data with anyone else.</p>
          </Section>

          <Section number="04" title="How long we keep it">
            <p>
              We keep your data for as long as your account is active. If you cancel, your data is
              kept for 30 days in case you change your mind. After 30 days, your account and all
              associated data is permanently deleted.
            </p>
          </Section>

          <Section number="05" title="Deleting your account">
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

          <Section number="06" title="Security">
            <p>
              All connections use HTTPS. Passwords are hashed and we cannot see them. Your business
              data is isolated at the database level so no other account can access it.
            </p>
          </Section>

          <Section number="07" title="Changes to this policy">
            <p>
              If we make meaningful changes to how we handle your data, we will email you before the
              changes take effect. The date at the top of this page will also be updated.
            </p>
          </Section>

        </div>

        {/* Bottom navigation */}
        <div className="mt-10 flex flex-wrap gap-6 text-sm">
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
