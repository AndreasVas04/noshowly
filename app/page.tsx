/**
 * app/page.tsx
 *
 * Root page — redirects immediately based on auth state.
 *
 * Logged-in users go to /dashboard.
 * Guests go to /register.
 *
 * This is a Server Component so the redirect happens before anything
 * is sent to the browser, avoiding a flash of content.
 */

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    redirect('/dashboard');
  } else {
    redirect('/register');
  }
}
