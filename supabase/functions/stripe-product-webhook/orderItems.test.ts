// Regression test for the swallowed `order_items` insert in stripe-product-webhook.
//
// Run from supabase/functions/:
//   deno test --no-check --allow-net --allow-env --allow-read stripe-product-webhook/orderItems.test.ts
//
// Why this exists — the defect, in the order it happens:
//
//   1. `payment_intent.succeeded` arrives. The stock hold is flipped to `sold`,
//      the `orders` row is written (status `paid`, funds captured, transfer to
//      the seller already on its way), and THAT insert's error is checked.
//   2. The `order_items` insert one statement later was not checked at all.
//      supabase-js resolves with `{ data, error }` and NEVER throws, so the
//      try/catch wrapping the whole switch cannot see it either.
//   3. Migration 090 added `order_items_variant_matches_product`, a composite FK
//      that rejects a mismatched (product_id, variant_id) pair — exactly the pair
//      an intent opened by the pre-090 checkout can still be carrying. 090's own
//      header calls this out: "Money taken, order row with no contents."
//   4. The handler then wrote `order_events.payment_confirmed`, cleared the cart,
//      and returned `{received: true}` to Stripe.
//
// Net result before this test: a paid order with zero line items. The buyer is
// charged, the seller's Studio order view has nothing to ship, and the dispute
// evidence builder (index.ts, the charge.dispute.created case) submits an empty
// `product_description` — losing the dispute by default. Nothing alerted.
//
// This is the `safetyStore.submitReport` shape from .claude/rules/superpowers-pipeline.md
// ("Report submitted 💜" over a write that never happened), on a money path.
//
// The handler is exercised for real: a genuinely signed Stripe event goes in, the
// Stripe REST calls are stubbed at `fetch`, and PostgREST is a local server that
// answers the way PostgREST actually answers — including a 409 + code 23503 for
// the constraint violation, which is what makes the swallowed error observable.
//
// Asserted locally rather than with std/assert, matching _shared/stockHold.test.ts
// and create-product-order/rateLimit.test.ts: every other module here is pinned to
// a URL specifier and a test has no business adding another one.

// NOTE: the handler module is imported dynamically, far below. A static import
// would be hoisted above both the `fetch` stub and the `Deno.serve` stub, so the
// module would bind a real port and capture the real `fetch` at load time.

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const WEBHOOK_SECRET = 'whsec_test_secret';
const PI_ID = 'pi_test_order_items';
const ORDER_ID = '0d1e2f30-4a5b-6c7d-8e9f-a0b1c2d3e4f5';
const BUYER_ID = '11111111-2222-3333-4444-555555555555';
const BUSINESS_ID = '22222222-3333-4444-5555-666666666666';
const CART_ID = '33333333-4444-5555-6666-777777777777';
const PRODUCT_ID = '44444444-5555-6666-7777-888888888888';
const DECOY_VARIANT_ID = '55555555-6666-7777-8888-999999999999';
/** Tier-1 PII. Goes into the intent metadata; must never reach a log or an alert row. */
const SHIPPING_NAME = 'A Real Buyer';

const enc = new TextEncoder();

// ── PostgREST double ─────────────────────────────────────────────────────────
// Only the tables this event type touches. Every response mirrors what PostgREST
// actually returns for the shape supabase-js asks for, because the whole defect
// lives in how a PostgREST error is (not) read.

interface Recorded {
  alerts: Array<Record<string, unknown>>;
  webhookPatches: Array<Record<string, unknown>>;
  orderEvents: Array<Record<string, unknown>>;
  cartDeletes: string[];
  orderItems: Array<Record<string, unknown>>;
  unstubbedStripe: string[];
}

function newRecorded(): Recorded {
  return {
    alerts: [], webhookPatches: [], orderEvents: [],
    cartDeletes: [], orderItems: [], unstubbedStripe: [],
  };
}

let rec = newRecorded();
/** When true the order_items insert is rejected by 090's composite FK. */
let rejectOrderItems = true;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The exact body PostgREST returns for a foreign-key violation. `code` is the
 * SQLSTATE, and `details` names the offending key — which is why `details` must
 * never be copied into an alert or a log verbatim without thinking about it.
 * src: https://docs.postgrest.org/en/v12/references/errors.html · 2026-08-07
 */
const FK_VIOLATION = {
  code: '23503',
  details: `Key (product_id, variant_id)=(${PRODUCT_ID}, ${DECOY_VARIANT_ID}) is not present in table "product_variants".`,
  hint: null,
  message:
    'insert or update on table "order_items" violates foreign key constraint "order_items_variant_matches_product"',
};

const abort = new AbortController();
const server = Deno.serve({ port: 0, signal: abort.signal, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const table = url.pathname.replace('/rest/v1/', '');

  if (table === 'webhook_events') {
    if (req.method === 'GET') return json([]);            // never seen this event id
    if (req.method === 'POST') return new Response(null, { status: 201 });
    if (req.method === 'PATCH') {
      rec.webhookPatches.push(await req.json() as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
  }

  if (table === 'orders') {
    if (req.method === 'GET') return json([]);            // no order for this intent yet
    // .select('id').single() → Accept: application/vnd.pgrst.object+json, so a
    // bare object rather than an array.
    if (req.method === 'POST') return json({ id: ORDER_ID }, 201);
  }

  if (table === 'order_items' && req.method === 'POST') {
    rec.orderItems.push(...await req.json() as Array<Record<string, unknown>>);
    return rejectOrderItems ? json(FK_VIOLATION, 409) : new Response(null, { status: 201 });
  }

  if (table === 'order_events' && req.method === 'POST') {
    rec.orderEvents.push(await req.json() as Record<string, unknown>);
    return new Response(null, { status: 201 });
  }

  if (table === 'cart_items' && req.method === 'DELETE') {
    rec.cartDeletes.push(url.searchParams.get('cart_id') ?? '');
    return new Response(null, { status: 204 });
  }

  if (table === 'reconciliation_alerts' && req.method === 'POST') {
    rec.alerts.push(await req.json() as Record<string, unknown>);
    return new Response(null, { status: 201 });
  }

  return json({ message: `unexpected ${req.method} ${url.pathname}` }, 500);
});

const origin = `http://localhost:${(server.addr as Deno.NetAddr).port}`;

/**
 * This module holds ONE stub HTTP server alive for every test in the file, and
 * the handler under test is imported once against it. Deno's leak sanitiser is
 * built for tests that acquire and release their own resources, so it flags that
 * deliberate module-scoped fixture on every test, and `npm:stripe` adds timers
 * of its own on top.
 *
 * This turns off resource bookkeeping and weakens no assertion below.
 */
const FIXTURE_SERVER = { sanitizeOps: false, sanitizeResources: false } as const;

// ── Stripe double ────────────────────────────────────────────────────────────
// index.ts builds its client with `Stripe.createFetchHttpClient()`, which binds
// `globalThis.fetch` at construction. Replacing fetch before the dynamic import
// is therefore enough to keep every Stripe call in-process.

const CHARGE = {
  id: 'ch_test_order_items',
  object: 'charge',
  transfer: 'tr_test_order_items',
  tax: 0,
  outcome: { risk_level: 'normal' },
};

const realFetch = globalThis.fetch.bind(globalThis);

function stripeResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === '/v1/charges') return json({ object: 'list', data: [CHARGE] });
  if (path === `/v1/payment_intents/${PI_ID}`) return json({ id: PI_ID, object: 'payment_intent' });
  if (path === '/v1/invoices') return json({ id: 'in_test', object: 'invoice' });
  if (path === '/v1/invoices/in_test/finalize') {
    return json({ id: 'in_test', object: 'invoice', hosted_invoice_url: 'https://invoice.test/x' });
  }
  rec.unstubbedStripe.push(path);
  return json({ error: { type: 'invalid_request_error', message: `unstubbed ${path}` } }, 400);
}

globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('https://api.stripe.com')) return Promise.resolve(stripeResponse(url));
  return realFetch(input as Request, init);
}) as typeof globalThis.fetch;

// Must be set before the handler module is imported — both clients are built at
// module scope from these.
Deno.env.set('SUPABASE_URL', origin);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_not_a_real_key');
Deno.env.set('STRIPE_PRODUCT_WEBHOOK_SECRET', WEBHOOK_SECRET);

// Capture the handler instead of letting the module bind a port.
let handler: ((req: Request) => Response | Promise<Response>) | null = null;
const realServe = Deno.serve;
Deno.serve = ((first: unknown, second?: unknown) => {
  handler = (typeof first === 'function' ? first : second) as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), addr: server.addr, ref() {}, unref() {} };
}) as unknown as typeof Deno.serve;

await import('./index.ts');
Deno.serve = realServe;

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * A real `Stripe-Signature`. constructEventAsync verifies this for itself, so an
 * unsigned or hand-waved payload would be rejected at the door and never reach
 * the code under test.
 * src: https://docs.stripe.com/webhooks/signatures · stripe-node 14 · 2026-08-07
 */
async function sign(payload: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${hex}`;
}

function paidEvent(eventId: string): string {
  return JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: PI_ID,
        object: 'payment_intent',
        amount: 12_000,
        currency: 'usd',
        customer: 'cus_test_order_items',
        metadata: {
          buyer_id: BUYER_ID,
          business_id: BUSINESS_ID,
          cart_id: CART_ID,
          subtotal_cents: '10000',
          shipping_cost_cents: '2000',
          platform_fee_cents: '500',
          shipping_name: SHIPPING_NAME,
          shipping_line1: '1 Test Street',
          shipping_city: 'Manila',
          shipping_state: 'NCR',
          shipping_postal_code: '1000',
          shipping_country: 'PH',
          // The pre-090 pair: a product paired with a variant belonging to a
          // different product. Representable in an intent opened by the old
          // checkout, refused by order_items_variant_matches_product now.
          items_json: JSON.stringify([{
            product_id: PRODUCT_ID,
            variant_id: DECOY_VARIANT_ID,
            product_name: 'A Coat',
            variant_label: 'One size',
            unit_price_cents: 10_000,
            quantity: 1,
          }]),
        },
      },
    },
  });
}

interface WebhookBody {
  success: boolean;
  data: { received: boolean; degraded?: string } | null;
  error: string | null;
}

async function deliver(eventId: string): Promise<{ status: number; body: WebhookBody }> {
  if (handler === null) throw new Error('stripe-product-webhook never registered a handler');
  const payload = paidEvent(eventId);
  const res = await handler(new Request('https://roxy.test/functions/v1/stripe-product-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': await sign(payload), 'Content-Type': 'application/json' },
    body: payload,
  }));
  return { status: res.status, body: await res.json() as WebhookBody };
}

function reset(reject: boolean): void {
  rec = newRecorded();
  rejectOrderItems = reject;
}

// ── The defect ───────────────────────────────────────────────────────────────

Deno.test({ name: 'a rejected order_items insert raises a reconciliation alert instead of being swallowed', ...FIXTURE_SERVER }, async () => {
  reset(true);

  const { status, body } = await deliver('evt_items_rejected');

  assertEquals(rec.unstubbedStripe, [], 'no unstubbed Stripe call — the double covers the whole path');
  assertEquals(rec.orderItems.length, 1, 'the insert was attempted');
  assertEquals(status, 200, 'Stripe is answered 200 — see the comment on the fix for why a retry cannot help');

  // The alert is the only durable trace of a paid order with nothing in it.
  assertEquals(rec.alerts.length, 1, 'a reconciliation_alerts row must be written');
  assertEquals(rec.alerts[0].order_id, ORDER_ID, 'the alert names the order a human has to go fix');
  assert(
    typeof rec.alerts[0].detail === 'string' && (rec.alerts[0].detail as string).length > 0,
    'the alert carries a detail an operator can act on',
  );

  // Visible and replayable in the same place every other failure in this handler
  // lands, rather than sitting on a row that still claims `processed`.
  assertEquals(rec.webhookPatches.length, 1, 'the webhook_events row is updated exactly once');
  assertEquals(rec.webhookPatches[0].status, 'failed', 'the event must not stay marked processed');

  // Stripe surfaces the endpoint's response body on the event's delivery record,
  // so this is a second trace reachable without a database query.
  assertEquals(body.success, true, 'still a 2xx envelope');
  assert(typeof body.data?.degraded === 'string', 'the response must not claim a clean receipt');
});

Deno.test({ name: 'the alert leaks no PII', ...FIXTURE_SERVER }, async () => {
  reset(true);

  await deliver('evt_items_rejected_pii');

  const written = JSON.stringify(rec.alerts);
  assertEquals(written.includes(SHIPPING_NAME), false, 'no shipping name in the alert');
  assertEquals(written.includes(BUYER_ID), false, 'no raw buyer id in the alert');
  assert(written.includes(ORDER_ID), 'the order id is safe to log and is what makes the alert actionable');
});

Deno.test({ name: 'a paid order whose items were rejected still has its cart cleared', ...FIXTURE_SERVER }, async () => {
  reset(true);

  await deliver('evt_items_rejected_cart');

  // Deliberate. Her money is already taken; leaving the paid rows in the cart
  // invites a second checkout for the same goods. The broken order is surfaced
  // by the alert, not by stranding the cart.
  assertEquals(rec.cartDeletes, [`eq.${CART_ID}`], 'cart cleared even on the failure path');
  assertEquals(rec.orderEvents.length, 1, 'payment_confirmed is still true and still recorded');
});

// ── The path that must stay quiet ────────────────────────────────────────────

Deno.test({ name: 'a successful order_items insert raises nothing', ...FIXTURE_SERVER }, async () => {
  reset(false);

  const { status, body } = await deliver('evt_items_ok');

  assertEquals(status, 200, 'happy path');
  assertEquals(rec.alerts, [], 'no alert on a healthy order');
  assertEquals(rec.webhookPatches, [], 'the event stays marked processed');
  assertEquals(body.data?.degraded, undefined, 'nothing degraded');
  assertEquals(rec.orderEvents.length, 1, 'payment_confirmed recorded');
  assertEquals(rec.cartDeletes.length, 1, 'cart cleared');
});

globalThis.addEventListener('unload', () => abort.abort());
