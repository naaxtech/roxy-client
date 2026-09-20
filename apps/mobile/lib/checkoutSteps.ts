/**
 * The checkout's three steps, and how they are announced.
 *
 * The step indicator was three numbered dots with no role, no label and no
 * current-step announcement — a screen reader heard "1 2 3". On the one screen
 * where a woman is about to spend money, that is the worst place in the app to
 * be lost, so the announcement lives here where it can be asserted without
 * rendering a payment sheet.
 *
 * The design's own labels are `1 · bag`, `2 · delivery & pay`, `3 · confirmed`.
 * This app splits delivery and payment into their own steps and confirms in a
 * separate sheet, which is a finer split than the prototype's and a better one
 * — a form that asks for an address and a card at once is a form she abandons.
 * The vocabulary is the design's; the decomposition is the app's.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · coStepLbl · 2026-09-02
 */

export const CHECKOUT_STEPS = ['review', 'shipping', 'payment'] as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

const LABELS: Record<CheckoutStep, string> = {
  review: 'Your bag',
  shipping: 'Delivery',
  payment: 'Payment',
};

export function checkoutStepLabel(step: CheckoutStep): string {
  return LABELS[step];
}

/**
 * The prototype's own step chip: `1 · bag`, `2 · delivery & pay`, `3 · confirmed`.
 * This app splits delivery and payment, so the third chip is pay rather than
 * confirmed (confirmation is a separate sheet). Same vocabulary, finer split.
 */
export function checkoutStepCompact(step: CheckoutStep): string {
  if (step === 'review') return '1 · bag';
  if (step === 'shipping') return '2 · delivery';
  return '3 · pay';
}

/**
 * What assistive tech reads when the indicator changes.
 *
 * Position, name and total, in that order — "Step 2 of 3: Delivery". Knowing
 * how many remain is what turns a form into something with an end.
 */
export function checkoutProgressLabel(step: CheckoutStep): string {
  const index = CHECKOUT_STEPS.indexOf(step);
  return `Step ${index + 1} of ${CHECKOUT_STEPS.length}: ${checkoutStepLabel(step)}`;
}
