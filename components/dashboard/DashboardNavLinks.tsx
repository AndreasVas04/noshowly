/**
 * components/dashboard/DashboardNavLinks.tsx
 *
 * Client component that renders sidebar and mobile nav links with active state
 * detection via usePathname. Extracted from the Server Component layout so that
 * active-route highlighting can use client-side navigation state.
 *
 * Exports:
 *  - DashboardNavLinks (default) — vertical sidebar nav for lg+ screens
 *  - MobileBottomNav (named)     — bottom tab bar fixed at screen bottom for mobile
 */

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Calendar, CalendarDays, Globe, Settings, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/** A single navigation entry. */
interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** All dashboard navigation links in display order. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Today',    href: '/dashboard',         icon: Calendar },
  { label: 'Week',     href: '/dashboard/week',     icon: CalendarDays },
  { label: 'Booking',  href: '/dashboard/booking',  icon: Globe },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
];

/**
 * DashboardNavLinks renders the vertical sidebar navigation for desktop.
 * The active link is highlighted with a white left border and white/15 bg.
 *
 * @returns A nav element with all dashboard links.
 */
export default function DashboardNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5">
      {NAV_ITEMS.map((item) => {
        // Exact match for /dashboard to avoid matching all sub-routes.
        const isActive =
          item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'text-white bg-white/15 border-l-[3px] border-white pl-[9px]'
                : 'text-white/60 hover:text-white hover:bg-white/10 border-l-[3px] border-transparent pl-[9px]',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * MobileBottomNav renders a fixed bottom tab bar for mobile screens (hidden on lg+).
 * Shows 4 navigation tabs plus a Sign out tab.
 * Active tab is highlighted in brand green; inactive tabs use warm grey.
 *
 * @returns A fixed nav element at the bottom of the viewport.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Signs the user out via Supabase and navigates to /login.
   * Errors are caught silently — middleware enforces auth on the next request.
   */
  async function handleSignOut(): Promise<void> {
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
    } catch {
      // Sign-out network error — redirect anyway.
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{ backgroundColor: '#1B4332' }}
    >
      <div className="flex items-stretch h-16">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);

          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
              style={{ color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.6)' }}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              <span
                className="text-[10px] leading-none"
                style={{ fontWeight: isActive ? 600 : 500 }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Sign out tab */}
        <button
          type="button"
          onClick={() => { void handleSignOut(); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          <LogOut className="w-5 h-5 shrink-0" strokeWidth={1.8} />
          <span className="text-[10px] font-medium leading-none">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
