/**
 * next.config.ts
 *
 * Next.js configuration: security headers on every response and no
 * "X-Powered-By" header.
 *
 * There is deliberately no site-wide Content-Security-Policy. The reminder
 * confirmation page (app/api/confirm/[token]/route.ts) sends its own strict
 * one, along with its own stricter Referrer-Policy.
 */

import type { NextConfig } from 'next';

/** Headers sent with every response. */
const SECURITY_HEADERS = [
  // Browsers must not guess a response's content type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Other sites see only the origin, and nothing when leaving HTTPS.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No page can be framed (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  // The app never uses the camera, the microphone or the location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // HTTPS only, for two years, subdomains included.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // These headers replace a route's own header of the same name, and a
      // later match wins: keep the confirmation page's "no-referrer", as its
      // URL carries the reminder token.
      {
        source: '/api/confirm/:token',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
