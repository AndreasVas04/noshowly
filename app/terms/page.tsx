/**
 * app/terms/page.tsx
 *
 * Terms of Service page for Noshowly.
 */

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Noshowly',
  description: 'Terms for using Noshowly.',
};

/**
 * Renders a labelled section with consistent spacing.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="space-y-2 text-gray-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">

      <header className="border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/register" className="text-xl font-bold text-gray-900 hover:text-gray-700 transition">
            Noshowly
          </Link>
          <Link href="/register" className="text-sm text-gray-500 hover:text-gray-900 transition">
            &larr; Back to home
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">

        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-400">Last updated: April 2026</p>
          <p className="mt-3 text-gray-600">
            By creating an account, you agree to these terms. Questions? Email{' '}
            <a href="mailto:noshowly@gmail.com" className="text-black underline underline-offset-2">
              noshowly@gmail.com
            </a>
            .
          </p>
        </div>

        <Section title="What Noshowly is">
          <p>
            Noshowly is an appointment scheduling and reminder service for service businesses.
            It lets you manage bookings and automatically send SMS and email reminders
            to your clients before their appointments.
          </p>
          <p>
            Noshowly handles scheduling and reminders only. We do not process payments between you
            and your clients and we do not interfere with your existing payment setup.
          </p>
        </Section>

        <Section title="Plans and pricing">
          <p>Noshowly offers three paid plans:</p>
          <p>
            <strong className="text-gray-800">Solo</strong> at $29.99 per month, includes 250
            reminders per month, suitable for solo practitioners.
          </p>
          <p>
            <strong className="text-gray-800">Team</strong> at $49.99 per month, includes 600
            reminders per month, suitable for teams of 2 to 4.
          </p>
          <p>
            <strong className="text-gray-800">Studio</strong> at $89.99 per month, includes 1,200
            reminders per month, suitable for 5 or more staff.
          </p>
          <p>
            Annual plans are available with 2 months free. Prices are in USD. We will give you at
            least 30 days notice before any price change.
          </p>
        </Section>

        <Section title="Billing and cancellation">
          <p>
            Billing is handled by Stripe. Your card details go directly to Stripe. We never see or store them. Your subscription renews automatically each month or year
            until you cancel. You can cancel at any time from your account settings.
          </p>
          <p>
            When you cancel, you keep access until the end of the current billing period. We do not
            cut off access mid-cycle.
          </p>
          <p>
            We do not offer refunds for forgetting to cancel before a renewal. If a technical error
            on our end prevents you from using the service, contact us and we will sort it out.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            Noshowly is for sending reminders to real clients about real appointments they have
            booked with you. Do not use it to send unsolicited messages, to contact people who have
            not booked an appointment, or to send fake or fabricated appointment reminders.
          </p>
          <p>
            Do not use Noshowly for any activity that violates applicable laws, including SMS and
            email marketing regulations in your country.
          </p>
          <p>
            If we see activity that looks like abuse, we will contact you. Repeated or serious
            violations may result in account suspension.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            The appointment and client data you enter into Noshowly belongs to you. We process it
            to run the service. When your account is deleted, your data is removed from our systems.
          </p>
          <p>
            See our{' '}
            <Link href="/privacy" className="text-black underline underline-offset-2">
              Privacy Policy
            </Link>{' '}
            for full details.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            Noshowly is provided as-is. We are not liable for missed appointments, lost revenue, or
            indirect damages arising from using the service. Our total liability for any claim is
            limited to the amount you have paid us in the three months before the incident.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            If we make meaningful changes, we will email you at least 30 days before they take
            effect. You can cancel before changes take effect if you do not agree with them.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms? Email{' '}
            <a href="mailto:noshowly@gmail.com" className="text-black underline underline-offset-2">
              noshowly@gmail.com
            </a>
            .
          </p>
        </Section>

        <div className="mt-10 pt-6 border-t border-gray-200 flex flex-wrap gap-4 text-sm text-gray-400">
          <Link href="/register" className="hover:text-gray-900 transition">Home</Link>
          <Link href="/privacy" className="hover:text-gray-900 transition">Privacy Policy</Link>
        </div>

      </main>
    </div>
  );
}
