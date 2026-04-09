/**
 * app/privacy/page.tsx
 *
 * Privacy Policy page for Noshowly.
 */

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Noshowly',
  description: 'How Noshowly collects, uses, and protects your data.',
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

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-400">Last updated: April 2026</p>
          <p className="mt-3 text-gray-600">
            Questions about this policy? Email us at{' '}
            <a href="mailto:noshowly@gmail.com" className="text-black underline underline-offset-2">
              noshowly@gmail.com
            </a>
            .
          </p>
        </div>

        <Section title="What we collect">
          <p>
            We collect your name, email address, salon name, and timezone when you create an account.
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
          <p>We use your data to run the Noshowly service, send appointment reminders to your
          clients, and fix bugs.</p>
          <p>We do not sell your data. We do not use it for advertising.</p>
        </Section>

        <Section title="Who we share it with">
          <p>
            We share data with a small number of services needed to run Noshowly.
          </p>
          <p>
            <strong className="text-gray-800">Twilio</strong>{' '}receives your client&apos;s phone
            number and the reminder message text to deliver SMS reminders.
          </p>
          <p>
            <strong className="text-gray-800">Resend</strong>{' '}receives your client&apos;s email
            address and the reminder content to deliver email reminders.
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
            <a href="mailto:noshowly@gmail.com" className="text-black underline underline-offset-2">
              noshowly@gmail.com
            </a>{' '}
            and we will handle it for you.
          </p>
        </Section>

        <Section title="Security">
          <p>
            All connections use HTTPS. Passwords are hashed and we cannot see them. Your salon data
            is isolated at the database level so no other salon can access it.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we make meaningful changes to how we handle your data, we will email you before the
            changes take effect. The date at the top of this page will also be updated.
          </p>
        </Section>

        <div className="mt-10 pt-6 border-t border-gray-200 flex flex-wrap gap-4 text-sm text-gray-400">
          <Link href="/register" className="hover:text-gray-900 transition">Home</Link>
          <Link href="/terms" className="hover:text-gray-900 transition">Terms of Service</Link>
        </div>

      </main>
    </div>
  );
}
