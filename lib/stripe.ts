/**
 * lib/stripe.ts
 *
 * Stripe client for server-side use only.
 *
 * IMPORTANT: Never import this file in Client Components or any browser-executed
 * code. The STRIPE_SECRET_KEY would be exposed in the client bundle.
 * Use NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY for any client-side Stripe code.
 *
 * This module exports a singleton Stripe instance configured with the secret key
 * from environment variables. Both the checkout route and webhook handler import
 * from here to avoid creating multiple instances.
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
}

/**
 * Singleton Stripe client configured for server-side use.
 *
 * Used by:
 *  - app/api/stripe/checkout/route.ts   — create Checkout sessions
 *  - app/api/webhooks/stripe/route.ts   — verify webhook signatures
 *
 * @example
 * ```ts
 * import { stripe } from '@/lib/stripe';
 * const session = await stripe.checkout.sessions.create({ ... });
 * ```
 */
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Pin the API version so SDK type definitions stay in sync with the live API.
  // This matches the version bundled with stripe@21. Update this when upgrading
  // the stripe package and migrating the webhook endpoint in the Stripe dashboard.
  apiVersion: '2026-03-25.dahlia',
});
