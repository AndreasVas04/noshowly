/**
 * lib/stripe.ts
 *
 * Stripe client for server-side use only.
 *
 * IMPORTANT: Never import this file in Client Components or any browser-executed
 * code. The STRIPE_SECRET_KEY would be exposed in the client bundle. There is
 * no client-side Stripe code: Checkout and the customer portal are pages
 * hosted by Stripe that the server sends the owner to.
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
 *  - app/api/stripe/sync/route.ts       — read a completed Checkout session
 *  - app/api/webhooks/stripe/route.ts   — verify webhook signatures
 *  - lib/billing/server.ts              — list and cancel subscriptions, read and
 *                                         create customers, create portal sessions
 *
 * @example
 * ```ts
 * import { stripe } from '@/lib/stripe';
 * const session = await stripe.checkout.sessions.create({ ... });
 * ```
 */
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Pin the API version so SDK type definitions stay in sync with the live API.
  // This is the version stripe@22.6 is built for. The webhook endpoint in the
  // Stripe Dashboard stays on 2026-03-25.dahlia: versions of the same release
  // (dahlia) only add fields, so its events still match these types. When the
  // stripe package moves to the next release, migrate the endpoint as well.
  apiVersion: '2026-08-26.dahlia',
});
