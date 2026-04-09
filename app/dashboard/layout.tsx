/**
 * app/dashboard/layout.tsx
 *
 * Shared layout for all /dashboard/* pages.
 *
 * Renders a two-column shell:
 *  - Left: fixed sidebar with navigation links (lg+ screens).
 *  - Right: scrollable main content area where each page renders.
 *
 * On mobile (<lg breakpoint) the sidebar collapses to a top navigation bar
 * so the app works on phone browsers without a native app.
 *
 * This is a Server Component — it fetches the salon name server-side so the
 * header renders with the correct name on first load without a client round-trip.
 *
 * Authentication:
 *  middleware.ts already guarantees the user is logged in before reaching any
 *  /dashboard/* route. This layout does NOT re-check auth — that would be
 *  redundant and add latency.
 */

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/layout/LogoutButton';

// ---------------------------------------------------------------------------
// Sidebar nav items
// ---------------------------------------------------------------------------

/** A single navigation entry in the sidebar. */
interface NavItem {
  label: string;
  href: string;
}

/** All sidebar navigation links. Extend this list as new pages are added. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Today', href: '/dashboard' },
  { label: 'Week', href: '/dashboard/week' },
  { label: 'Settings', href: '/dashboard/settings' },
];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * DashboardLayout wraps every /dashboard/* page with the sidebar and header.
 * Fetches the salon name server-side so the correct name appears immediately.
 *
 * @param children - The page content rendered in the main content area.
 * @returns The full dashboard shell with navigation.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ---------------------------------------------------------------------------
  // Fetch salon name for the header (server-side — no extra client round-trip).
  // Falls back to "My Salon" if the fetch fails so the layout never crashes.
  // ---------------------------------------------------------------------------
  let salonName = 'My Salon';

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      const { data: salon } = await supabase
        .from('salons')
        .select('name')
        .eq('user_id', session.user.id)
        .single();

      if (salon?.name) {
        salonName = salon.name;
      }
    }
  } catch {
    // Non-fatal — layout renders with fallback name
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">

      {/* ===================================================================
          SIDEBAR — hidden on mobile, visible as left column on lg+
      ==================================================================== */}
      <aside className="
        hidden lg:flex lg:flex-col
        w-56 shrink-0
        bg-white border-r border-gray-200
        min-h-screen sticky top-0
      ">
        {/* Brand */}
        <div className="px-6 py-5 border-b border-gray-200">
          <span className="text-lg font-bold text-gray-900">Noshowly</span>
        </div>

        {/* Salon name */}
        <div className="px-6 py-4 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-800 truncate">{salonName}</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="
                flex items-center px-3 py-2 rounded-lg text-sm font-medium
                text-gray-600 hover:text-gray-900 hover:bg-gray-50
                transition-colors
              "
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Logout button — client component */}
        <div className="px-3 py-4 border-t border-gray-200">
          <LogoutButton />
        </div>
      </aside>

      {/* ===================================================================
          MOBILE TOP BAR — visible below lg breakpoint
      ==================================================================== */}
      <header className="
        lg:hidden
        flex items-center justify-between gap-4
        bg-white border-b border-gray-200
        px-4 py-3
      ">
        {/* Brand */}
        <span className="text-base font-bold text-gray-900 shrink-0">Noshowly</span>

        {/* Horizontal nav — scrollable if viewport is very narrow */}
        <nav className="flex items-center gap-4 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors shrink-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Logout — shrunk for mobile */}
        <div className="shrink-0">
          <LogoutButton />
        </div>
      </header>

      {/* ===================================================================
          MAIN CONTENT AREA
      ==================================================================== */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>

    </div>
  );
}
