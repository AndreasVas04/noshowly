/**
 * components/layout/LogoutButton.tsx
 *
 * Client Component: renders a "Sign out" button styled for the dark sidebar.
 * Calls Supabase signOut and redirects to /login.
 *
 * Security: Supabase clears the session cookie on signOut — the middleware will
 * enforce this on the next /dashboard/* request even if the client-side redirect fails.
 */

'use client';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

/**
 * Renders a "Sign out" button styled for the dark sidebar.
 * On click, signs the user out of Supabase and navigates to /login.
 *
 * @returns A styled button element that triggers sign-out.
 */
export default function LogoutButton() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  /**
   * Signs the user out via Supabase, then navigates to /login.
   * Errors are caught silently — navigation to /login happens regardless.
   */
  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Sign-out network error — redirect anyway; middleware enforces auth.
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="
        w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap
        text-white/40 hover:text-white/70 hover:bg-white/5
        transition-colors
      "
    >
      Sign out
    </button>
  );
}
