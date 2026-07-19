import { callEdgeFunction } from './supabase';

export type DonationCadence = 'one_time' | 'monthly' | 'yearly';

const MIN_DONATION_CENTS = 500;
const MAX_DONATION_CENTS = 100000;

/**
 * Clamps a donation amount (in cents) to [$5, $1000] and rounds to the
 * nearest whole dollar (round-half-up), so the amount stepper and any
 * manual entry always land on a clean dollar figure.
 */
export function clampDonationAmount(cents: number): number {
  const roundedToDollar = Math.round(cents / 100) * 100;
  return Math.min(MAX_DONATION_CENTS, Math.max(MIN_DONATION_CENTS, roundedToDollar));
}

/**
 * Starts a Roxy donation checkout via the create-donation-checkout edge
 * function. Returns the Stripe checkout URL to open, or null on any failure
 * (network error, edge function error, or a malformed response) — callers
 * show a friendly retry alert on null.
 */
export async function startDonationCheckout(
  amountCents: number,
  cadence: DonationCadence,
): Promise<string | null> {
  try {
    const { data, error } = await callEdgeFunction<{ url: string }>('create-donation-checkout', {
      amount_cents: amountCents,
      cadence,
    });
    if (error || !data) return null;
    return data.url ?? null;
  } catch {
    return null;
  }
}
