/**
 * components/layout/LogoutButton.tsx
 *
 * Client Component: renders a "Sign out" button that calls Supabase signOut
 * and redirects to /login.
 *
 * Extracted from the dashboard layout so the layout can remain a Server Component
 * (and do server-side data fetching) while this small piece handles browser APIs.
 *
 * Security: Supabase clears the session cookie on signOut — the middleware will
 * enforce this on the next /dashboard/* request even if the client-side redirect fails.
 */

'use client';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

/**
 * Renders a "Sign out" button.
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
   * The middleware will clear the stale session on the next protected-route request.
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
        w-full text-left px-3 py-2 rounded-lg text-sm font-medium
        text-gray-500 hover:text-gray-900 hover:bg-gray-50
        transition-colors
      "
    >
      Sign out
    </button>
  );
}
