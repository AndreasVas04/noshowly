/**
 * app/pricing/PricingPageHeader.tsx
 *
 * Client component — sticky header for the pricing page with
 * backdrop blur on scroll. Extracted from the Server Component so that
 * scroll state can use client-side event listeners.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

/** Props passed from the server component parent. */
interface PricingPageHeaderProps {
  /** When true, shows a "Dashboard" link (user is on a paid plan). */
  showDashboardLink: boolean;
}

/**
 * Renders a sticky pricing page header with forest green background that gains
 * a backdrop blur shadow when the user scrolls past 20px.
 *
 * @param props - showDashboardLink flag from the server.
 * @returns The pricing page header JSX.
 */
export default function PricingPageHeader({ showDashboardLink }: PricingPageHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    /** Tracks scroll position to add blur effect at 20px threshold. */
    function handleScroll() {
      setScrolled(window.scrollY > 20);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={[
        'sticky top-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-[#1B4332]/95 backdrop-blur-md shadow-md'
          : 'bg-[#1B4332]',
      ].join(' ')}
    >
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link href="/" aria-label="Noshowly home">
          <Image src="/Logo.png" alt="Noshowly" width={160} height={40} className="h-9 w-auto" />
        </Link>

        <nav className="flex items-center gap-6" aria-label="Pricing page navigation">
          <Link
            href="/"
            className="text-sm text-white/60 hover:text-white transition-colors font-body"
          >
            Home
          </Link>
          {showDashboardLink && (
            <Link
              href="/dashboard"
              className="text-sm text-white/60 hover:text-white transition-colors font-body"
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/login"
            className="text-sm text-white/60 hover:text-white transition-colors font-body"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
