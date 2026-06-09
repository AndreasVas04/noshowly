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
 * Design: dark gradient sidebar, Playfair Display logo, Montserrat nav.
 * Active route highlighting handled client-side by DashboardNavLinks.
 *
 * This is a Server Component — fetches the salon name server-side.
 */

import Image from 'next/image';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/layout/LogoutButton';
import DashboardNavLinks, { MobileNavLinks } from '@/components/dashboard/DashboardNavLinks';

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
      <aside
        className="hidden lg:flex lg:flex-col w-60 shrink-0 min-h-screen sticky top-0"
        style={{ background: 'linear-gradient(180deg, #1A1A1A 0%, #111111 100%)' }}
      >
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

        {/* Nav links — client component for active-state detection */}
        <DashboardNavLinks />

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
      <header
        className="lg:hidden flex items-center justify-between gap-4 px-4 py-3"
        style={{ background: 'linear-gradient(180deg, #1A1A1A 0%, #111111 100%)' }}
      >
        {/* Brand */}
        <Image src="/Logo.png" alt="Noshowly" width={120} height={32} className="h-7 w-auto shrink-0" />

        {/* Horizontal nav — client component for active-state detection */}
        <MobileNavLinks />

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
