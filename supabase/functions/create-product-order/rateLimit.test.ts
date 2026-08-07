// Regression test for the per-buyer checkout limit on create-product-order.
//
// Run from supabase/functions/:
//   deno test --allow-net --allow-env create-product-order/rateLimit.test.ts
//
// Why this exists: this function opened a Stripe PaymentIntent and decremented
// every variant in the cart with NO per-user limit of any kind, while the other
// twelve authenticated functions in this project all call checkRateLimit. Each
// request with a fresh idempotency_key took more stock. Holds come back only via
// the buyer's own release call, a payment_intent.canceled webhook, or a sweep
// that runs only when somebody else checks out, reaps at most 20 intents, and
// ignores anything younger than 30 minutes — so holds accrued far faster than
// they were reaped, and on a marketplace of one-of-a-kind handmade items one
// member could make every product on the platform read "out of stock" for free.
//
// The second assertion here matters as much as the first: that an accepted
// checkout consumes exactly one unit of quota.
//
// This file used to explain that the limit worked ONLY because the handler
// remembered to call logAiCall beside checkRateLimit, and named the six
// functions that forgot -- cancel-event, create-payment-intent, gdpr-delete,
// gdpr-export, stripe-dashboard-link, submit-report -- whose counters were
// therefore permanently 0. That pair is gone (migration 091): consume_rate_limit
// counts and records in one statement, so a guard can no longer be added without
// its log, and the harness below stubs the RPC rather than the table.
//
// The handler is exercised for real. With SUPABASE_URL on localhost the module's
// DEV_MOCK is on, so the checkout returns its mock body without touching Stripe —
// and per CLAUDE.md section 7 the rate limit still runs, which is precisely the
// path under test.

// NOTE: the handler module is imported dynamically, far below. A static import
// here would be hoisted above the Deno.serve stub and the module would bind a
// real port at load time instead of handing over its handler.

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const BUYER = '11111111-2222-3333-4444-555555555555';
const OTHER_BUYER = '99999999-8888-7777-6666-555555555555';
const KID = 'test-signing-key';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (value: unknown) => b64url(enc.encode(JSON.stringify(value)));

const KEY_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

const projectKey = await crypto.subtle.generateKey(KEY_PARAMS, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', projectKey.publicKey);

interface LogRow {
  id: string;
  user_id: string;
  function_name: string;
  conversation_id: string | null;
  called_at: string;
}

// Stands in for the project's Auth origin and its PostgREST endpoint. ai_call_log
// is kept in memory so the real checkRateLimit/logAiCall pair does real counting.
const rows: LogRow[] = [];

interface ConsumeArgs {
  p_user_id: string;
  p_fn_name: string;
  p_max_count: number;
  p_window_type: 'daily' | 'lifetime' | 'conversation';
  p_conversation_id: string | null;
  p_was_mock: boolean;
}

/**
 * Stands in for `consume_rate_limit` (migration 091).
 *
 * The window predicates are reimplemented here rather than approximated,
 * because a stub that counts differently from the database proves nothing about
 * the cap. The one thing it cannot reproduce is the advisory lock — that
 * serialises concurrent callers, and this harness issues requests in sequence.
 *
 * Note it both COUNTS and WRITES, which is the whole point of the function it
 * mirrors: there is no way to ask it "am I under the cap" without consuming.
 */
function consumeRateLimit(args: ConsumeArgs): {
  allowed: boolean;
  current_count: number;
  call_id: string | null;
} {
  const midnightUtc = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

  const count = rows.filter((row) => {
    if (row.user_id !== args.p_user_id) return false;
    if (row.function_name !== args.p_fn_name) return false;
    if (args.p_window_type === 'daily' && row.called_at < midnightUtc) return false;
    if (args.p_window_type === 'conversation' && row.conversation_id !== args.p_conversation_id) {
      return false;
    }
    return true;
  }).length;

  if (count >= args.p_max_count) return { allowed: false, current_count: count, call_id: null };

  const id = crypto.randomUUID();
  rows.push({
    id,
    user_id: args.p_user_id,
    function_name: args.p_fn_name,
    conversation_id: args.p_conversation_id,
    called_at: new Date().toISOString(),
  });
  return { allowed: true, current_count: count + 1, call_id: id };
}

const abort = new AbortController();
const server = Deno.serve({ port: 0, signal: abort.signal, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith('/.well-known/jwks.json')) {
    return Response.json({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] });
  }

  // A function RETURNS TABLE, so PostgREST answers an RPC with an array of rows.
  // `consumeRateLimit` reads `data[0]` and treats an empty array as a limiter
  // failure, so returning a bare object here would silently exercise the
  // failure-policy branch instead of the cap.
  if (url.pathname === '/rest/v1/rpc/consume_rate_limit' && req.method === 'POST') {
    return Response.json([consumeRateLimit(await req.json() as ConsumeArgs)]);
  }

  if (url.pathname === '/rest/v1/rpc/refund_rate_limit' && req.method === 'POST') {
    const { p_user_id, p_call_id } = await req.json() as { p_user_id: string; p_call_id: string };
    const at = rows.findIndex((r) => r.id === p_call_id && r.user_id === p_user_id);
    if (at !== -1) rows.splice(at, 1);
    return Response.json(at !== -1);
  }

  // No `/rest/v1/ai_call_log` route on purpose. The table is the rate-limit
  // ledger and consume_rate_limit is the only thing allowed to write it, so a
  // direct read or write from a handler should fail loudly here rather than
  // quietly work — that split is the defect this whole change removes.
  return Response.json({ message: 'unexpected request' }, { status: 500 });
});

const origin = `http://localhost:${(server.addr as Deno.NetAddr).port}`;

/**
 * This module holds ONE stub HTTP server alive for every test in the file — it
 * stands in for the project's Auth origin and PostgREST, and the handler under
 * test is imported once against it. Deno's leak sanitiser is built for tests
 * that acquire and release their own resources, so it flags that deliberate
 * module-scoped fixture on every single test, and `npm:stripe` adds timers of
 * its own on top.
 *
 * This turns off resource bookkeeping. It does not weaken a single assertion
 * below — without it the file cannot report whether the cap works at all,
 * which is the one thing it exists to answer.
 */
const FIXTURE_SERVER = { sanitizeOps: false, sanitizeResources: false } as const;

// Must be set before the handler module is imported: DEV_MOCK is evaluated at
// module scope, and `localhost` is what turns it on.
Deno.env.set('SUPABASE_URL', origin);
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

// Capture the handler instead of letting the module bind a port.
let handler: ((req: Request) => Response | Promise<Response>) | null = null;
const realServe = Deno.serve;
Deno.serve = ((first: unknown, second?: unknown) => {
  handler = (typeof first === 'function' ? first : second) as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), addr: server.addr, ref() {}, unref() {} };
}) as unknown as typeof Deno.serve;

const { CHECKOUT_ATTEMPTS_PER_DAY } = await import('./index.ts');
Deno.serve = realServe;

function call(req: Request): Promise<Response> {
  if (handler === null) throw new Error('create-product-order never registered a handler');
  return Promise.resolve(handler(req));
}

async function token(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID });
  const body = b64urlJson({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${origin}/auth/v1`,
    iat: now,
    exp: now + 3600,
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign(SIGN_PARAMS, projectKey.privateKey, enc.encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(signature)}`;
}

async function checkout(userId: string, n: number): Promise<Response> {
  return await call(new Request('https://roxy.test/functions/v1/create-product-order', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cart_id: `cart-${n}`,
      idempotency_key: `key-${userId}-${n}`,
      shipping_address: {
        name: 'A Buyer', line1: '1 Test Street', city: 'Manila',
        state: 'NCR', postal_code: '1000', country: 'PH',
      },
    }),
  }));
}

function reset(): void {
  rows.length = 0;
}

Deno.test({ name: 'create-product-order refuses checkouts past the daily cap', ...FIXTURE_SERVER }, async () => {
  reset();

  for (let n = 0; n < CHECKOUT_ATTEMPTS_PER_DAY; n++) {
    assertEquals((await checkout(BUYER, n)).status, 200, `attempt ${n + 1} within the cap`);
  }

  const refused = await checkout(BUYER, CHECKOUT_ATTEMPTS_PER_DAY);
  assertEquals(refused.status, 429, 'the attempt past the cap');

  const payload = await refused.json() as { success: boolean; error: string };
  assertEquals(payload.success, false, 'refusal is an error response');
  assertEquals(
    payload.error.includes('cart-') || payload.error.includes(BUYER),
    false,
    'the refusal must not echo cart ids or the buyer id back',
  );
});

Deno.test({ name: 'every accepted checkout consumes exactly one unit of quota', ...FIXTURE_SERVER }, async () => {
  reset();

  for (let n = 0; n < 3; n++) await checkout(BUYER, n);

  // Without this, checkRateLimit counts an empty table forever and the cap above
  // can never be reached — the bug five other functions in this project have.
  assertEquals(rows.length, 3, 'attempts recorded in ai_call_log');
  assertEquals(rows.every((r) => r.function_name === 'create-product-order'), true, 'logged under this function');
  assertEquals(rows.every((r) => r.user_id === BUYER), true, 'logged against the caller from the JWT');
});

Deno.test({ name: 'a refused checkout does not consume further quota', ...FIXTURE_SERVER }, async () => {
  reset();

  for (let n = 0; n <= CHECKOUT_ATTEMPTS_PER_DAY; n++) await checkout(BUYER, n);
  const afterFirstRefusal = rows.length;
  await checkout(BUYER, 999);

  assertEquals(rows.length, afterFirstRefusal, 'a 429 must not bill the buyer another attempt');
});

Deno.test({ name: 'one buyer cannot exhaust another buyer’s quota', ...FIXTURE_SERVER }, async () => {
  reset();

  for (let n = 0; n <= CHECKOUT_ATTEMPTS_PER_DAY; n++) await checkout(BUYER, n);

  assertEquals((await checkout(OTHER_BUYER, 0)).status, 200, 'an unrelated buyer is unaffected');
});

Deno.test({ name: 'handing a hold back is never rate limited', ...FIXTURE_SERVER }, async () => {
  reset();

  for (let n = 0; n <= CHECKOUT_ATTEMPTS_PER_DAY; n++) await checkout(BUYER, n);

  // A buyer who has hit the cap must still be able to give stock back — rate
  // limiting the release would keep her holds standing for the full window and
  // make the marketplace's inventory problem worse, not better.
  const release = await call(new Request('https://roxy.test/functions/v1/create-product-order', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(BUYER)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ release_payment_intent_id: 'pi_whatever' }),
  }));

  assertEquals(release.status, 200, 'release accepted while checkout is capped');
});

Deno.test({ name: 'an unauthenticated caller is refused before any quota is touched', ...FIXTURE_SERVER }, async () => {
  reset();

  const res = await call(new Request('https://roxy.test/functions/v1/create-product-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart_id: 'cart-x', idempotency_key: 'k', shipping_address: {} }),
  }));

  assertEquals(res.status, 401, 'no token, no checkout');
  assertEquals(rows.length, 0, 'an anonymous request must not be able to burn anyone’s quota');
});

globalThis.addEventListener('unload', () => abort.abort());
