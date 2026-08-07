// Regression tests for the stock-hold reaper and the per-buyer concurrency cap.
//
// Lives in _shared/ so the Supabase CLI does not treat it as a deployable
// function (files under an underscore-prefixed folder are not deployed).
//
// Run from supabase/functions/:
//   deno test --allow-net --allow-env _shared/stockHold.test.ts
//
// Why this exists — two defects, both of which let one member decide what the
// whole marketplace has in stock:
//
//   1. create-product-order took no per-buyer limit at all, so a member could
//      open unbounded PaymentIntents, each decrementing every variant in the
//      cart. `findConflictingHold` is the concurrency half of the fix: while she
//      is already sitting on live reserved stock, she does not get to reserve
//      more. On a marketplace of one-of-a-kind handmade items, unbounded holds
//      read as "sold out" platform-wide.
//
//   2. The sweep reaped on `created < cutoff` — intent AGE, not idle time. A
//      buyer 35 minutes into a 3DS challenge (banking-app hop, SMS delay) had
//      her live intent cancelled out from under her by an unrelated buyer's
//      checkout. Age alone cannot tell "walked away" from "still paying"; only
//      status can.
//
// Asserted locally rather than with std/assert: every other module here is
// pinned to a URL specifier, and a test has no business adding another one.

import type Stripe from 'npm:stripe@14';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HOLD_KEY,
  HOLD_WINDOW_MINUTES,
  IN_FLIGHT_GRACE_MINUTES,
  findConflictingHold,
  sweepAbandonedHolds,
} from './stockHold.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const BUYER = '11111111-2222-3333-4444-555555555555';
const OTHER_BUYER = '99999999-8888-7777-6666-555555555555';
const CART = 'cart-under-checkout';
const OTHER_CART = 'cart-somewhere-else';
const CUSTOMER = 'cus_buyer';

const NOW = 1_800_000_000;

type PaymentIntent = Stripe.PaymentIntent;
type IntentStatus = PaymentIntent['status'];

interface IntentSpec {
  id: string;
  status: IntentStatus;
  ageMinutes: number;
  hold?: string;
  buyerId?: string;
  cartId?: string;
  items?: Array<{ variant_id: string | null; quantity: number }>;
}

function intent(spec: IntentSpec): PaymentIntent {
  const metadata: Record<string, string> = {
    buyer_id: spec.buyerId ?? BUYER,
    cart_id: spec.cartId ?? CART,
    items_json: JSON.stringify(spec.items ?? [{ variant_id: 'var-1', quantity: 2 }]),
  };
  if (spec.hold !== undefined) metadata[HOLD_KEY] = spec.hold;
  return {
    id: spec.id,
    created: NOW - Math.round(spec.ageMinutes * 60),
    status: spec.status,
    metadata,
  } as unknown as PaymentIntent;
}

interface ListParams {
  customer?: string;
  created?: { gte?: number };
  limit?: number;
}

interface Calls {
  listParams: ListParams[];
  canceled: string[];
  marked: Array<{ id: string; state: string }>;
  increments: Array<{ variantId: string; qty: number }>;
}

function newCalls(): Calls {
  return { listParams: [], canceled: [], marked: [], increments: [] };
}

function fakeStripe(
  calls: Calls,
  opts: { pool?: PaymentIntent[]; listThrows?: boolean; uncancellable?: string[] } = {},
): Stripe {
  const pool = opts.pool ?? [];
  return {
    paymentIntents: {
      list(params: ListParams) {
        calls.listParams.push(params);
        if (opts.listThrows === true) return Promise.reject(new Error('stripe is down'));
        return Promise.resolve({ data: pool });
      },
      search(_params: { query: string; limit: number }) {
        return Promise.resolve({ data: pool });
      },
      cancel(id: string) {
        if (opts.uncancellable?.includes(id) === true) {
          return Promise.reject(new Error('intent cannot be canceled'));
        }
        calls.canceled.push(id);
        const found = pool.find((pi) => pi.id === id);
        return Promise.resolve({ ...found, status: 'canceled' } as PaymentIntent);
      },
      update(id: string, params: { metadata: Record<string, string> }) {
        calls.marked.push({ id, state: params.metadata[HOLD_KEY] });
        return Promise.resolve(pool.find((pi) => pi.id === id) as PaymentIntent);
      },
    },
  } as unknown as Stripe;
}

function fakeSupabase(calls: Calls): SupabaseClient {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === 'increment_variant_stock') {
        calls.increments.push({ variantId: String(args.p_variant_id), qty: Number(args.p_qty) });
      }
      return Promise.resolve({ data: true, error: null });
    },
  } as unknown as SupabaseClient;
}

const conflictArgs = { customerId: CUSTOMER, buyerId: BUYER, cartId: CART, nowSeconds: NOW };

// ── findConflictingHold ──────────────────────────────────────────────────────

Deno.test('findConflictingHold refuses a second checkout while live stock is already held', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({ id: 'pi_open', status: 'requires_payment_method', ageMinutes: 5, hold: 'held', cartId: OTHER_CART })],
  });

  const conflict = await findConflictingHold(stripe, conflictArgs);

  assert(conflict !== null, 'a live hold on another cart must block a new checkout');
  assertEquals(conflict?.paymentIntentId, 'pi_open', 'conflicting intent');
  assertEquals(
    conflict?.retryAfterSeconds,
    (HOLD_WINDOW_MINUTES - 5) * 60,
    'retry-after counts down to when the sweep can reap it',
  );
});

Deno.test('findConflictingHold scopes the lookup to this buyer only', async () => {
  const calls = newCalls();
  await findConflictingHold(fakeStripe(calls), conflictArgs);

  assertEquals(calls.listParams.length, 1, 'exactly one lookup');
  assertEquals(calls.listParams[0].customer, CUSTOMER, 'lookup must be scoped to the buyer’s customer');
  assertEquals(
    calls.listParams[0].created?.gte,
    NOW - IN_FLIGHT_GRACE_MINUTES * 60,
    'lookup bounded to the longest a hold can stay unreapable',
  );
});

Deno.test('findConflictingHold allows an idempotent retry of the same cart', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({ id: 'pi_same', status: 'requires_payment_method', ageMinutes: 5, hold: 'held', cartId: CART })],
  });

  // Replaying the same idempotency key is how this function hands a buyer back
  // her own client_secret after an app reload. Refusing it would lock her out
  // of the checkout she is already paying for.
  assertEquals(await findConflictingHold(stripe, conflictArgs), null, 'same-cart replay');
});

Deno.test('findConflictingHold ignores holds the sweep is already free to reap', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({
      id: 'pi_stale',
      status: 'requires_payment_method',
      ageMinutes: HOLD_WINDOW_MINUTES + 1,
      hold: 'held',
      cartId: OTHER_CART,
    })],
  });

  assertEquals(await findConflictingHold(stripe, conflictArgs), null, 'reapable hold must not block');
});

Deno.test('findConflictingHold ignores intents that are not holding stock', async () => {
  for (const hold of ['released', 'sold', undefined]) {
    const calls = newCalls();
    const stripe = fakeStripe(calls, {
      pool: [intent({ id: 'pi_x', status: 'requires_payment_method', ageMinutes: 1, hold, cartId: OTHER_CART })],
    });
    assertEquals(await findConflictingHold(stripe, conflictArgs), null, `hold state ${String(hold)}`);
  }
});

Deno.test('findConflictingHold ignores terminal intents', async () => {
  for (const status of ['succeeded', 'canceled'] as IntentStatus[]) {
    const calls = newCalls();
    const stripe = fakeStripe(calls, {
      pool: [intent({ id: 'pi_done', status, ageMinutes: 1, hold: 'held', cartId: OTHER_CART })],
    });
    assertEquals(await findConflictingHold(stripe, conflictArgs), null, `status ${status}`);
  }
});

Deno.test('findConflictingHold ignores an intent belonging to another buyer', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({
      id: 'pi_theirs',
      status: 'requires_payment_method',
      ageMinutes: 1,
      hold: 'held',
      cartId: OTHER_CART,
      buyerId: OTHER_BUYER,
    })],
  });

  assertEquals(await findConflictingHold(stripe, conflictArgs), null, 'another buyer’s hold');
});

Deno.test('findConflictingHold fails open when Stripe is unreachable', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, { listThrows: true });

  // A processor outage must not stop the marketplace selling. The daily rate
  // limit is the backstop that still bounds abuse while this check is blind.
  assertEquals(await findConflictingHold(stripe, conflictArgs), null, 'outage');
});

// ── sweepAbandonedHolds: idle time, not intent age ───────────────────────────

Deno.test('sweep leaves a buyer mid-3DS alone past the hold window', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({ id: 'pi_3ds', status: 'requires_action', ageMinutes: 35, hold: 'held' })],
  });

  const released = await sweepAbandonedHolds(stripe, fakeSupabase(calls), NOW);

  assertEquals(released, 0, 'nothing reaped');
  assertEquals(calls.canceled, [], 'a live 3DS challenge must never be cancelled');
  assertEquals(calls.increments, [], 'her reserved stock must stay reserved');
});

Deno.test('sweep reaps an idle intent once the hold window has passed', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({
      id: 'pi_idle',
      status: 'requires_payment_method',
      ageMinutes: HOLD_WINDOW_MINUTES + 5,
      hold: 'held',
      items: [{ variant_id: 'var-9', quantity: 3 }],
    })],
  });

  const released = await sweepAbandonedHolds(stripe, fakeSupabase(calls), NOW);

  assertEquals(released, 1, 'reaped');
  assertEquals(calls.canceled, ['pi_idle'], 'cancelled before release');
  assertEquals(calls.increments, [{ variantId: 'var-9', qty: 3 }], 'stock handed back');
});

Deno.test('sweep reaps an abandoned 3DS challenge once the grace window has passed', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({
      id: 'pi_abandoned_3ds',
      status: 'requires_action',
      ageMinutes: IN_FLIGHT_GRACE_MINUTES + 1,
      hold: 'held',
    })],
  });

  // The grace is generous, not infinite: a challenge nobody came back to still
  // has to give the units up, or a closed app parks them forever.
  assertEquals(await sweepAbandonedHolds(stripe, fakeSupabase(calls), NOW), 1, 'reaped');
});

Deno.test('sweep releases an already-canceled hold without asking Stripe to cancel it again', async () => {
  const calls = newCalls();
  const stripe = fakeStripe(calls, {
    pool: [intent({ id: 'pi_cancelled', status: 'canceled', ageMinutes: 40, hold: 'held' })],
    uncancellable: ['pi_cancelled'],
  });

  // Cancelled is terminal: Stripe has already confirmed these units can never
  // be paid for. Routing this through cancelAndRelease would throw on the
  // cancel and leave the hold standing — which is what happens today whenever
  // the payment_intent.canceled webhook is not delivered.
  const released = await sweepAbandonedHolds(stripe, fakeSupabase(calls), NOW);

  assertEquals(released, 1, 'reaped without the webhook');
  assertEquals(calls.canceled, [], 'no cancel attempted on a canceled intent');
  assertEquals(calls.increments, [{ variantId: 'var-1', qty: 2 }], 'stock handed back');
});

Deno.test('sweep leaves intents the processor still owns alone', async () => {
  for (const status of ['processing', 'succeeded', 'requires_capture'] as IntentStatus[]) {
    const calls = newCalls();
    const stripe = fakeStripe(calls, {
      pool: [intent({ id: 'pi_busy', status, ageMinutes: IN_FLIGHT_GRACE_MINUTES + 60, hold: 'held' })],
    });

    assertEquals(await sweepAbandonedHolds(stripe, fakeSupabase(calls), NOW), 0, `status ${status}`);
    assertEquals(calls.canceled, [], `status ${status} must not be cancelled`);
  }
});
