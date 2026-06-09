/**
 * app/dashboard/layout.tsx
 *
 * Shared layout for all /dashboard/* pages.
 *
 * Renders a two-column shell:
 *  - Left: fixed dark sidebar with navigation links (lg+ screens).
 *  - Right: scrollable main content area where each page renders.
 *
 * On mobile (<lg breakpoint) the sidebar collapses to a top navigation bar.
 *
 * Design: dark (#1A1A1A) sidebar, Playfair Display logo, Montserrat nav.
 *
 * This is a Server Component — fetches the salon name server-side.
 */

import Link from 'next/link';
import Image from 'next/image';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/layout/LogoutButton';

/** A single navigation entry in the sidebar. */
interface NavItem {
  label: string;
  href: string;
}

/** All sidebar navigation links. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Today', href: '/dashboard' },
  { label: 'Week', href: '/dashboard/week' },
  { label: 'Booking', href: '/dashboard/booking' },
  { label: 'Settings', href: '/dashboard/settings' },
];

/**
 * DashboardLayout wraps every /dashboard/* page with the sidebar and header.
 * Fetches the salon name server-side for zero client-side flash.
 *
 * @param children - The page content rendered in the main content area.
 * @returns The full dashboard shell with navigation.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let salonName = 'My Business';

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
    <div className="min-h-screen bg-[#F9F9F9] flex flex-col lg:flex-row">

      {/* =================================================================
          SIDEBAR — hidden on mobile, visible as left column on lg+
      ================================================================== */}
      <aside className="
        hidden lg:flex lg:flex-col
        w-60 shrink-0
        bg-[#1A1A1A]
        min-h-screen sticky top-0
      ">
        {/* Brand logo */}
        <div className="px-6 py-6 border-b border-white/10">
          <Image src="/Logo.png" alt="Noshowly" width={160} height={40} className="h-10 w-auto" />
        </div>

        {/* Business name */}
        <div className="px-6 py-4 border-b border-white/10">
          <p className="text-xs font-medium text-white/40 uppercase tracking-widest mb-0.5">
            Business
          </p>
          <p className="text-sm font-medium text-white/80 truncate">{salonName}</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="
                flex items-center px-3 py-2.5 rounded-lg text-sm font-medium
                text-white/60 hover:text-white hover:bg-white/10
                transition-colors
              "
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Upgrade link */}
        <div className="px-3 pb-2">
          <Link
            href="/pricing"
            className="
              flex items-center px-3 py-2.5 rounded-lg text-sm font-medium
              text-white/40 hover:text-white/70 hover:bg-white/5
              transition-colors
            "
          >
            Upgrade plan
          </Link>
        </div>

        {/* Logout button */}
        <div className="px-3 py-4 border-t border-white/10">
          <LogoutButton />
        </div>
      </aside>

      {/* =================================================================
          MOBILE TOP BAR — visible below lg breakpoint
      ================================================================== */}
      <header className="
        lg:hidden
        flex items-center justify-between gap-4
        bg-[#1A1A1A]
        px-4 py-3
      ">
        {/* Brand */}
        <Image src="/Logo.png" alt="Noshowly" width={120} height={32} className="h-7 w-auto shrink-0" />

        {/* Horizontal nav */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Logout */}
        <div className="shrink-0">
          <LogoutButton />
        </div>
      </header>

      {/* =================================================================
          MAIN CONTENT AREA
      ================================================================== */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>

    </div>
  );
}
