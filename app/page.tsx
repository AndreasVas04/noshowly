/**
 * app/page.tsx
 *
 * Public landing page for Noshowly.
 *
 * Authenticated users are redirected to /dashboard before any content is sent
 * to the browser. Unauthenticated visitors see the full marketing page.
 *
 * Server Component — only handles auth check and redirect.
 * All content is rendered by LandingContent (Client Component).
 */

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import LandingNav from '@/components/landing/LandingNav';
import LandingContent from '@/components/landing/LandingContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Noshowly: Stop Losing Money to No-Shows',
  description:
    'Noshowly automatically sends email reminders before every booking. Clients confirm or cancel with one click. Flat monthly fee, zero commissions.',
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
    <div className="min-h-screen bg-[#FAFAF8] font-body text-[#1A1A1A]">
      <LandingNav />
      <LandingContent />
    </div>
  );
}
