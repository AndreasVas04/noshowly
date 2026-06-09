/**
 * app/layout.tsx
 *
 * Root layout for the entire Noshowly app.
 *
 * Fonts:
 *  - Playfair Display → --font-heading → all h1/h2/h3, page titles, logo
 *  - Montserrat       → --font-body    → body text, labels, buttons, inputs, nav
 *
 * Both are loaded via next/font/google and injected as CSS custom properties
 * on the <html> element so Tailwind's font-heading and font-body utilities
 * resolve to the correct typefaces at runtime.
 */

import type { Metadata } from 'next';
import { Playfair_Display, Montserrat } from 'next/font/google';
import './globals.css';

/** Playfair Display — used for all headings and the brand logo. */
const playfair = Playfair_Display({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

/** Montserrat — used for all body copy, labels, buttons, and navigation. */
const montserrat = Montserrat({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Noshowly: Appointment Reminders',
  description:
    'Noshowly automatically reminds your clients before every appointment. Flat monthly fee, zero commissions, 5-minute setup.',
};

/**
 * Root layout — applies fonts and global styles to every page in the app.
 *
 * @param children - The active page rendered inside this shell.
 * @returns The full HTML document shell with fonts loaded.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ fontFamily: 'var(--font-body), system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
