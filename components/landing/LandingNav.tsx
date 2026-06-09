/**
 * components/landing/LandingNav.tsx
 *
 * Responsive navigation bar for the public landing page.
 * Client component because the mobile menu requires toggle state.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X } from 'lucide-react';

/**
 * LandingNav renders a sticky top navigation bar with logo, section links,
 * sign-in link, and a start-trial CTA. Collapses to a hamburger on mobile.
 *
 * @returns The navigation bar JSX.
 */
export default function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#C8C8C8]/40 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" aria-label="Noshowly home">
          <Image src="/Logo.png" alt="Noshowly" width={160} height={40} className="h-8 w-auto" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          <a
            href="#features"
            className="text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors font-body"
          >
            Features
          </a>
          <a
            href="#pricing"
            className="text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors font-body"
          >
            Pricing
          </a>
          <Link
            href="/login"
            className="text-sm text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors font-body"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="h-9 px-5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-lg transition-colors inline-flex items-center font-body"
          >
            Start free trial
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="md:hidden p-2 text-[#1A1A1A] rounded-lg hover:bg-[#F9F9F9] transition-colors"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-[#C8C8C8]/40 bg-white px-6 py-5 space-y-4">
          <a
            href="#features"
            onClick={() => setOpen(false)}
            className="block text-sm text-[#1A1A1A] font-body py-1"
          >
            Features
          </a>
          <a
            href="#pricing"
            onClick={() => setOpen(false)}
            className="block text-sm text-[#1A1A1A] font-body py-1"
          >
            Pricing
          </a>
          <Link href="/login" className="block text-sm text-[#1A1A1A] font-body py-1">
            Sign in
          </Link>
          <Link
            href="/register"
            className="block w-full h-11 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg transition-colors text-center leading-[2.75rem] font-body mt-2"
          >
            Start free trial
          </Link>
        </div>
      )}
    </header>
  );
}
