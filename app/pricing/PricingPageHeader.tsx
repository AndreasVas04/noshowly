/**
 * app/pricing/PricingPageHeader.tsx
 *
 * Client component — minimal sticky header for the pricing page.
 * Single purpose: let users navigate back to the landing page.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

/**
 * Renders a minimal sticky pricing page header with forest green background.
 * Shows only a logo and a "Back to home" link.
 *
 * @returns The pricing page header JSX.
 */
export default function PricingPageHeader() {
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
        {/* Back to home */}
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors font-body group"
          aria-label="Back to home"
        >
          <svg
            className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to home
        </Link>

        {/* Logo */}
        <Link href="/" aria-label="Noshowly home">
          <Image src="/Logo.png" alt="Noshowly" width={140} height={36} className="h-8 w-auto" />
        </Link>
      </div>
    </header>
  );
}
