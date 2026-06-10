/**
 * app/terms/page.tsx
 *
 * Terms of Service page for Noshowly.
 * Design: "Calm Professional" palette — #FAFAF8 background, Playfair Display
 * headings, Montserrat body, forest green #1B4332 accent.
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
 * Terms of Service page.
 *
 * @returns The full terms page with shared nav and footer.
 */
export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-4 text-sm text-[#8A8680] font-body">
            Last updated: April 2026
          </p>
          <p className="mt-3 text-[#4A4540] font-body">
            Questions about these terms? Email us at{' '}
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

        <Section title="Agreement to terms">
          <p>
            By creating a Noshowly account, you agree to these terms. If you do not agree, do not
            use the service.
          </p>
          <p>
            &ldquo;Noshowly&rdquo; refers to this service and the company that operates it.
            &ldquo;You&rdquo; refers to the business owner using the service.
          </p>
        </Section>

        <Section title="What Noshowly provides">
          <p>
            Noshowly is a scheduling and appointment reminder tool for service businesses. It lets
            you manage appointments and automatically send SMS and email reminders to your clients.
          </p>
          <p>
            Noshowly does not handle payments between you and your clients. We only handle the
            monthly subscription you pay to use Noshowly.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You are responsible for keeping your login credentials secure. You must notify us
            immediately if you suspect unauthorised access.
          </p>
          <p>
            You are responsible for all activity that happens under your account. Each Noshowly
            account is for one business. You may not share your account with other businesses.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You may use Noshowly only for lawful business purposes.</p>
          <p>You must not:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Send unsolicited messages to people who have not booked an appointment with you.</li>
            <li>Use the service to harass, threaten, or spam anyone.</li>
            <li>Attempt to reverse-engineer or access the service in unauthorised ways.</li>
            <li>Violate any applicable laws or regulations.</li>
          </ul>
          <p>
            We may suspend or terminate your account if you violate these rules without notice or
            refund.
          </p>
        </Section>

        <Section title="Billing and plans">
          <p>Noshowly is offered on three paid plans, billed monthly in USD:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong className="text-[#1A1A1A]">Starter</strong> at $19/month. Includes unlimited
              email reminders. No SMS reminders.
            </li>
            <li>
              <strong className="text-[#1A1A1A]">Professional</strong> at $39/month. Includes
              unlimited email reminders and 300 SMS reminders per month.
            </li>
            <li>
              <strong className="text-[#1A1A1A]">Business</strong> at $79/month. Includes unlimited
              email reminders and 1,000 SMS reminders per month.
            </li>
          </ul>
          <p>
            Annual plans are available at a discount equivalent to two months free. All prices are
            in US dollars.
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

        <Section title="SMS usage">
          <p>
            SMS reminders are sent via Twilio. Message frequency depends on the number of
            appointments you schedule. Standard carrier rates may apply to your clients for
            receiving messages in some countries.
          </p>
          <p>
            You are responsible for ensuring you have a lawful basis for sending messages to your
            clients in your jurisdiction.
          </p>
        </Section>

        <Section title="Data and privacy">
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
            accurate and that you have consent to contact clients via SMS and email.
          </p>
        </Section>

        <Section title="Limitation of liability">
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

        <Section title="Changes to these terms">
          <p>
            We may update these terms from time to time. We will email you before material changes
            take effect. Continued use of the service after that date constitutes acceptance of the
            updated terms.
          </p>
        </Section>

        <Section title="Contact">
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

        {/* Bottom nav */}
        <div className="mt-12 pt-8 flex flex-wrap gap-6 text-sm">
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
