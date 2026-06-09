/**
 * components/dashboard/DashboardNavLinks.tsx
 *
 * Client component that renders sidebar and mobile nav links with active state
 * detection via usePathname. Extracted from the Server Component layout so that
 * active-route highlighting can use client-side navigation state.
 *
 * Exports:
 *  - DashboardNavLinks (default) — vertical sidebar nav for lg+ screens
 *  - MobileNavLinks (named) — horizontal scrollable nav for mobile header
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A single navigation entry. */
interface NavItem {
  label: string;
  href: string;
}

/** All dashboard navigation links in display order. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Today', href: '/dashboard' },
  { label: 'Week', href: '/dashboard/week' },
  { label: 'Booking', href: '/dashboard/booking' },
  { label: 'Settings', href: '/dashboard/settings' },
];

/**
 * DashboardNavLinks renders the vertical sidebar navigation.
 * The active link is highlighted with an indigo left border and white/10 bg.
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
                ? 'text-white bg-white/10 border-l-[3px] border-[#6366F1] pl-[9px]'
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
 * MobileNavLinks renders the horizontal scrollable navigation for the mobile
 * top bar. Active links use an indigo bottom border for visual distinction.
 *
 * @returns A nav element with all dashboard links in a horizontal layout.
 */
export function MobileNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'text-sm font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0',
              isActive
                ? 'text-white bg-white/15 border-b-2 border-[#6366F1]'
                : 'text-white/60 hover:text-white hover:bg-white/10',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
