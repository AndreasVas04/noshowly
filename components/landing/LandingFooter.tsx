/**
 * components/landing/LandingFooter.tsx
 *
 * Shared footer used across the landing page and legal pages.
 * Three-column layout: Brand, Product links, Company links.
 * Dark background (#1A1A1A) to close each page with weight.
 */

import Link from 'next/link';
import Image from 'next/image';

/**
 * LandingFooter renders the site-wide footer with three link columns.
 *
 * @returns The footer JSX.
 */
export default function LandingFooter() {
  return (
    <footer className="bg-[#1A1A1A]">
      <div className="mx-auto max-w-6xl px-6 pt-14 pb-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 pb-10 border-b border-white/10">

          {/* Brand */}
          <div>
            <Image
              src="/Logo.png"
              alt="Noshowly"
              width={140}
              height={36}
              className="h-7 w-auto mb-4"
            />
            <p className="text-sm text-white/50 font-body leading-relaxed max-w-xs">
              Email reminders and online booking for service businesses. Flat monthly price, zero commissions.
            </p>
          </div>

          {/* Product links */}
          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4 font-body">
              Product
            </p>
            <nav className="space-y-3" aria-label="Footer product links">
              <a href="/#features" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Features
              </a>
              <a href="/#pricing" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Pricing
              </a>
              <Link href="/login" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Sign in
              </Link>
              <Link href="/register" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Create account
              </Link>
            </nav>
          </div>

          {/* Legal */}
          <div>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4 font-body">
              Company
            </p>
            <nav className="space-y-3" aria-label="Footer company links">
              <Link href="/privacy" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Privacy Policy
              </Link>
              <Link href="/terms" className="block text-sm text-white/60 hover:text-white transition-colors font-body">
                Terms of Service
              </Link>
              <p className="text-sm text-white/50 font-body leading-relaxed">
                Questions? Email us at{' '}
                <a
                  href="mailto:noshowly@gmail.com"
                  className="text-white/70 hover:text-white transition-colors underline underline-offset-2"
                >
                  noshowly@gmail.com
                </a>
              </p>
            </nav>
          </div>

        </div>

        <p className="pt-8 text-xs text-white/30 font-body">
          &copy; {new Date().getFullYear()} Noshowly. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
