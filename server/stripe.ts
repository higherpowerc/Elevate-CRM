/**
 * Guarded Stripe client (live-test finding 2026-08-17 — "Send payment link"
 * placeholder on the owner's Clients tab).
 *
 * Stripe is NOT connected yet: STRIPE_SECRET_KEY is unset in every
 * environment, and the payment-link endpoint returns 503 until it is. Once
 * the owner adds STRIPE_SECRET_KEY as a business secret, stripeClient()
 * starts returning a real client and the endpoint "just works" — no code
 * change needed.
 *
 * The client is ONLY initialized when the key exists (lazy singleton), so the
 * app never crashes, imports Stripe eagerly, or makes any network call when
 * Stripe is not configured.
 */

import Stripe from "stripe";

let _stripe: Stripe | null = null;

/** The shared Stripe client, or null when STRIPE_SECRET_KEY is unset. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) return null;
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}
