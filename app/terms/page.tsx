/**
 * app/terms/page.tsx
 *
 * Terms of Service page for Noshowly.
 * Design: "Calm Professional" — forest green hero banner (#1B4332), white content
 * card on #FAFAF8 warm off-white, Playfair Display headings, Montserrat body.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import LandingNav from '@/components/landing/LandingNav';
import LandingFooter from '@/components/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'Terms of Service - Noshowly',
  description: 'The terms and conditions for using the Noshowly service.',
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
 * Terms of Service page.
 *
 * @returns The full terms page with shared nav and footer.
 */
export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-4 text-white/60 font-body text-sm tracking-wide">
            Last updated: April 2026
          </p>
          <div className="mt-7 w-10 h-px bg-white/25" />
          <p className="mt-6 text-white/65 font-body text-sm">
            Questions about these terms? Email us at{' '}
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

          <Section number="01" title="Agreement to terms">
            <p>
              By creating a Noshowly account, you agree to these terms. If you do not agree, do not
              use the service.
            </p>
            <p>
              &ldquo;Noshowly&rdquo; refers to this service and the company that operates it.
              &ldquo;You&rdquo; refers to the business owner using the service.
            </p>
          </Section>

          <Section number="02" title="What Noshowly provides">
            <p>
              Noshowly is a scheduling and appointment reminder tool for service businesses. It lets
              you manage appointments and automatically send email reminders to your clients.
            </p>
            <p>
              Noshowly does not handle payments between you and your clients. We only handle the
              monthly subscription you pay to use Noshowly.
            </p>
          </Section>

          <Section number="03" title="Your account">
            <p>
              You are responsible for keeping your login credentials secure. You must notify us
              immediately if you suspect unauthorised access.
            </p>
            <p>
              You are responsible for all activity that happens under your account. Each Noshowly
              account is for one business. You may not share your account with other businesses.
            </p>
          </Section>

          <Section number="04" title="Acceptable use">
            <p>You may use Noshowly only for lawful business purposes.</p>
            <p>You must not:</p>
            <ul className="list-none space-y-2 mt-1">
              {[
                'Send unsolicited messages to people who have not booked an appointment with you.',
                'Use the service to harass, threaten, or spam anyone.',
                'Attempt to reverse-engineer or access the service in unauthorised ways.',
                'Violate any applicable laws or regulations.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-[0.45em] w-1 h-1 rounded-full bg-[#1B4332]/40 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p>
              We may suspend or terminate your account if you violate these rules without notice or
              refund.
            </p>
          </Section>

          <Section number="05" title="Billing and plans">
            <p>
              Noshowly is offered on one paid plan, billed monthly in USD:
            </p>
            <ul className="list-none space-y-2 mt-1">
              <li className="flex items-start gap-2.5">
                <span className="mt-[0.45em] w-1 h-1 rounded-full bg-[#1B4332]/40 shrink-0" />
                <span>
                  <strong className="font-semibold text-[#1A1A1A]">Basic</strong>{' '}
                  at $19/month. Includes online booking and unlimited email reminders.
                </span>
              </li>
            </ul>
            <p>
              All prices are in US dollars.
            </p>
            <p>
              Subscriptions renew automatically. You may cancel at any time. Cancellation takes effect
              at the end of your current billing period. No partial refunds are issued.
            </p>
            <p>
              We may change prices with 30 days notice. If you do not agree to a price change, you
              may cancel before it takes effect.
            </p>
          </Section>

          <Section number="06" title="Messaging">
            <p>
              Email reminders are sent via Resend. Message frequency depends on the number of
              appointments you schedule. You are responsible for ensuring you have a lawful basis
              for sending messages to your clients in your jurisdiction.
            </p>
          </Section>

          <Section number="07" title="Data and privacy">
            <p>
              Your use of the service is also governed by our{' '}
              <Link
                href="/privacy"
                className="text-[#1B4332] underline underline-offset-2 hover:text-[#16392A] transition-colors"
              >
                Privacy Policy
              </Link>
              .
            </p>
            <p>
              You own your data. You are responsible for ensuring the client information you enter is
              accurate and that you have consent to contact clients via email.
            </p>
          </Section>

          <Section number="08" title="Limitation of liability">
            <p>
              Noshowly is provided &ldquo;as is&rdquo; without warranties of any kind. We do not
              guarantee that the service will be uninterrupted or error-free.
            </p>
            <p>
              We are not liable for missed reminders due to carrier failures, spam filters, incorrect
              client contact details, or events outside our reasonable control.
            </p>
            <p>
              To the maximum extent permitted by law, our total liability to you for any claim does
              not exceed the amount you paid us in the 30 days before the claim arose.
            </p>
          </Section>

          <Section number="09" title="Changes to these terms">
            <p>
              We may update these terms from time to time. We will email you before material changes
              take effect. Continued use of the service after that date constitutes acceptance of the
              updated terms.
            </p>
          </Section>

          <Section number="10" title="Contact">
            <p>
              For any questions about these terms, email us at{' '}
              <a
                href="mailto:noshowly@gmail.com"
                className="text-[#1B4332] underline underline-offset-2 hover:text-[#16392A] transition-colors"
              >
                noshowly@gmail.com
              </a>
              .
            </p>
          </Section>

        </div>

        {/* Bottom navigation */}
        <div className="mt-10 flex flex-wrap gap-6 text-sm">
          <Link href="/" className="text-[#8A8680] hover:text-[#1A1A1A] transition-colors font-body">
            Home
          </Link>
          <Link href="/privacy" className="text-[#8A8680] hover:text-[#1A1A1A] transition-colors font-body">
            Privacy Policy
          </Link>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
