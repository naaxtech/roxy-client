// RevenueCat webhook: auth, payload validation, event → effect mapping, handler.
//
// Run from supabase/functions/:
//   deno test --no-check --allow-env _shared/revenuecat.test.ts
//
// Payloads are the documented samples (revenuecat.com/docs/integrations/webhooks/
// sample-events, read 2026-10-26) with Roxy's ids and entitlement swapped in.
// The database half (apply_supporter_event: replay, ordering, transfer) is
// proven in supabase/tests/140_supporter_entitlements_check.sql.

import {
  type ApplyArgs,
  type ApplyFn,
  checkAuthorization,
  effectFor,
  handleRevenueCatWebhook,
  parseWebhook,
  REFUND_SKEW_MS,
  type RejectArgs,
  type RejectFn,
  resolveUserId,
  SUPPORTER_ENTITLEMENT,
} from './revenuecat.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const SECRET = 'rc-webhook-secret-0123456789abcdef';
const U1 = '6f1c2a9e-3b4d-4c5e-8f60-718293a4b5c6';
const U2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ANON = '$RCAnonymousID:8069238d6049ce87cc529853916d624c';
const EMAIL = 'her@example.com';
// sha-256 hex, computed independently (node:crypto createHash('sha256')), so
// the test does not trust the implementation's own hashing.
const U1_HASH = 'fc199ff3a8dc0c4e241b3a4ce43f6815bd4cd58f97714ae0f0d6b3d1a4cbd468';
const ANON_HASH = 'bbac5b823f781bf64b7e4875acf77dbe1fe8166a8760e85f6a0e2701095daa64';

type Ev = Record<string, unknown>;

/** The INITIAL_PURCHASE sample, as Roxy's SDK would produce it. */
function event(over: Ev = {}): Ev {
  return {
    event_timestamp_ms: 1658726378679,
    product_id: 'roxy_supporter_monthly:monthly',
    period_type: 'NORMAL',
    purchased_at_ms: 1658726374000,
    expiration_at_ms: 1659331174000,
    environment: 'PRODUCTION',
    entitlement_id: null,
    entitlement_ids: [SUPPORTER_ENTITLEMENT],
    presented_offering_id: null,
    transaction_id: 'GPA.3372-0001',
    original_transaction_id: 'GPA.3372-0000',
    is_family_share: false,
    country_code: 'PH',
    app_user_id: U1,
    aliases: [ANON, U1],
    original_app_user_id: ANON,
    currency: 'USD',
    price: 4.99,
    price_in_purchased_currency: 4.99,
    subscriber_attributes: { $email: { updated_at_ms: 1662955084635, value: EMAIL } },
    store: 'PLAY_STORE',
    type: 'INITIAL_PURCHASE',
    id: '12345678-1234-1234-1234-123456789012',
    app_id: '1234567890',
    ...over,
  };
}
const body = (ev: Ev, api_version: unknown = '1.0') => ({ api_version, event: ev });

function args(ev: Ev): ApplyArgs {
  const r = parseWebhook(body(ev));
  if (r.ok === false) throw new Error(`expected a valid payload, got: ${r.error}`);
  return r.args;
}
function rejects(input: unknown, label: string) {
  const r = parseWebhook(input);
  ok(!r.ok, `${label}: was accepted`);
}

// ── checkAuthorization ────────────────────────────────────────────────────

Deno.test('auth: the configured value, verbatim or as a Bearer token, is the only key', () => {
  eq(checkAuthorization(SECRET, SECRET), 'ok', 'verbatim');
  eq(checkAuthorization(`Bearer ${SECRET}`, SECRET), 'ok', 'Bearer');
  eq(checkAuthorization(`Bearer ${SECRET}`, `Bearer ${SECRET}`), 'ok', 'dashboard value includes the scheme');
  eq(checkAuthorization(null, SECRET), 'unauthorized', 'missing header');
  eq(checkAuthorization('', SECRET), 'unauthorized', 'empty header');
  eq(checkAuthorization(`${SECRET}x`, SECRET), 'unauthorized', 'longer');
  eq(checkAuthorization(SECRET.slice(0, -1), SECRET), 'unauthorized', 'shorter');
  eq(checkAuthorization(`Basic ${SECRET}`, SECRET), 'unauthorized', 'other scheme');
  eq(checkAuthorization(`xx ${SECRET}`, SECRET), 'unauthorized', 'secret embedded in a longer header');
});

Deno.test('auth: no usable secret configured rejects every caller (fail closed)', () => {
  eq(checkAuthorization(SECRET, undefined), 'unconfigured', 'unset');
  eq(checkAuthorization('', ''), 'unconfigured', 'empty env, empty header');
  eq(checkAuthorization('   ', '   '), 'unconfigured', 'whitespace');
  eq(checkAuthorization('short', 'short'), 'unconfigured', 'shorter than 16 chars');
});

// ── resolveUserId ─────────────────────────────────────────────────────────

Deno.test('who is she: app_user_id first, else exactly one uuid among the aliases', () => {
  eq(resolveUserId(event()), U1, 'app_user_id is the Supabase id');
  eq(resolveUserId(event({ app_user_id: U1.toUpperCase() })), U1, 'case-normalised');
  eq(resolveUserId(event({ app_user_id: ANON, aliases: [ANON, U2], original_app_user_id: ANON })), U2, 'anon + one alias');
  eq(resolveUserId(event({ app_user_id: ANON, aliases: [ANON, U1, U2] })), null, 'two members aliased: refuse to guess');
  eq(resolveUserId(event({ app_user_id: ANON, aliases: [ANON], original_app_user_id: ANON })), null, 'anonymous only');
  eq(resolveUserId(event({ app_user_id: 42, aliases: 'nope', original_app_user_id: null })), null, 'garbage');
});

// ── effectFor: every documented type ─────────────────────────────────────

Deno.test('effect: purchases, renewals and restorations activate', () => {
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
                      'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED']) {
    eq(effectFor(event({ type })), 'activate', type);
  }
});

Deno.test('effect: billing issue is grace, expiration expires, product change is informational', () => {
  eq(effectFor(event({ type: 'BILLING_ISSUE' })), 'grace', 'BILLING_ISSUE');
  eq(effectFor(event({ type: 'EXPIRATION', expiration_reason: 'UNSUBSCRIBE' })), 'expire', 'EXPIRATION');
  eq(effectFor(event({ type: 'PRODUCT_CHANGE', new_product_id: 'roxy_supporter_yearly:yearly' })), 'change', 'PRODUCT_CHANGE');
});

Deno.test('effect: a cancellation keeps her to period end', () => {
  for (const reason of ['UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED', 'PRICE_INCREASE', 'UNKNOWN']) {
    eq(effectFor(event({ type: 'CANCELLATION', cancel_reason: reason })), 'cancel', reason);
  }
});

Deno.test('effect: a CUSTOMER_SUPPORT refund revokes only when RevenueCat ended the access', () => {
  // The documented refund sample: expiration moved to before the event.
  const refund = { type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99 };
  eq(effectFor(event({ ...refund, event_timestamp_ms: 1601337615995, expiration_at_ms: 1601336705000 })), 'refund', 'access ended');
  eq(effectFor(event({ ...refund, event_timestamp_ms: 1601337615995, expiration_at_ms: 1601337615995 })), 'refund', 'ends now');
  eq(effectFor(event({ ...refund, expiration_at_ms: null })), 'refund', 'lifetime purchase refunded');
  // "refunds can be given without canceling a subscription": period still running.
  eq(effectFor(event({ ...refund, event_timestamp_ms: 1658726378679, expiration_at_ms: 1659331174000 })), 'cancel',
    'goodwill refund, subscription still active');
});

Deno.test('effect: a refund stamped a little after its own event still revokes (two clocks)', () => {
  const refund = { type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99 };
  const at = 1601337615995;
  eq(REFUND_SKEW_MS, 5 * 60 * 1000, 'tolerance');
  eq(effectFor(event({ ...refund, event_timestamp_ms: at, expiration_at_ms: at + 1_000 })), 'refund', '1 s after');
  eq(effectFor(event({ ...refund, event_timestamp_ms: at, expiration_at_ms: at + 60_000 })), 'refund', '1 min after');
  eq(effectFor(event({ ...refund, event_timestamp_ms: at, expiration_at_ms: at + REFUND_SKEW_MS })), 'refund',
    'exactly at the tolerance');
  eq(effectFor(event({ ...refund, event_timestamp_ms: at, expiration_at_ms: at + REFUND_SKEW_MS + 1 })), 'cancel',
    'just past the tolerance: the period is still running');
  eq(effectFor(event({ ...refund, event_timestamp_ms: at, expiration_at_ms: at + 86_400_000 })), 'cancel',
    'a day left: goodwill refund');
  eq(effectFor(event({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: at, expiration_at_ms: at })),
    'cancel', 'not a refund at all');
});

Deno.test('effect: TRANSFER moves; TEST and everything else is only logged', () => {
  eq(effectFor({ type: 'TRANSFER', transferred_from: [U2], transferred_to: [U1] }), 'transfer', 'TRANSFER');
  for (const type of ['TEST', 'SUBSCRIPTION_PAUSED', 'TEMPORARY_ENTITLEMENT_GRANT', 'INVOICE_ISSUANCE',
                      'VIRTUAL_CURRENCY_TRANSACTION', 'EXPERIMENT_ENROLLMENT', 'PURCHASE_REDEEMED',
                      'SUBSCRIBER_ALIAS', 'PRICE_INCREASE_CONSENT_REQUIRED', 'PRICE_INCREASE_CONSENT_APPROVED',
                      'SOMETHING_RC_ADDS_NEXT_YEAR']) {
    eq(effectFor(event({ type })), 'log', type);
  }
});

Deno.test('effect: an event for another entitlement never touches Supporter', () => {
  eq(effectFor(event({ entitlement_ids: ['pro'] })), 'log', 'other entitlement');
  eq(effectFor(event({ entitlement_ids: null })), 'log', 'no entitlement');
  eq(effectFor(event({ type: 'EXPIRATION', entitlement_ids: ['pro'] })), 'log', 'other entitlement expiring');
  eq(effectFor(event({ entitlement_ids: ['pro', SUPPORTER_ENTITLEMENT] })), 'activate', 'bundle including it');
});

// ── parseWebhook: the arguments apply_supporter_event receives ────────────

Deno.test('parse: an initial purchase becomes typed, normalised arguments', () => {
  eq(args(event()), {
    p_event_id: '12345678-1234-1234-1234-123456789012',
    p_type: 'INITIAL_PURCHASE',
    p_effect: 'activate',
    p_user_id: U1,
    p_event_at: new Date(1658726378679).toISOString(),
    p_environment: 'production',
    p_period_ends_at: new Date(1659331174000).toISOString(),
    p_store: 'play_store',
    p_product_id: 'roxy_supporter_monthly:monthly',
    p_original_transaction_ref: 'GPA.3372-0000',
    p_from_user_ids: null,
    p_payload: args(event()).p_payload,
  }, 'initial purchase');
});

Deno.test('parse: the stored payload is an allowlist — no attributes, country, metadata', () => {
  const a = args(event({ metadata: { note: 'free text' }, experiments: [{ experiment_id: 'x' }], surprise_field: 1 }));
  for (const k of ['subscriber_attributes', 'country_code', 'metadata', 'experiments', 'surprise_field']) {
    ok(!(k in a.p_payload), `${k} was stored`);
  }
  ok(!JSON.stringify(a.p_payload).includes(EMAIL), 'email reached the payload');
  eq(
    [a.p_payload.api_version, a.p_payload.type, a.p_payload.id, a.p_payload.product_id,
     a.p_payload.original_transaction_id, a.p_payload.app_user_id, a.p_payload.price],
    ['1.0', 'INITIAL_PURCHASE', '12345678-1234-1234-1234-123456789012', 'roxy_supporter_monthly:monthly',
     'GPA.3372-0000', U1, 4.99],
    'what support needs is kept',
  );
});

Deno.test('parse: periods — lifetime, grace end, sandbox', () => {
  eq(args(event({ type: 'NON_RENEWING_PURCHASE', expiration_at_ms: null })).p_period_ends_at, 'infinity',
    'null expiration on an activation is lifetime (RC: null for lifetime products)');
  const grace = args(event({ type: 'BILLING_ISSUE', expiration_at_ms: 1601319047000, grace_period_expiration_at_ms: 1601933447000 }));
  eq([grace.p_effect, grace.p_period_ends_at], ['grace', new Date(1601933447000).toISOString()], 'grace runs to its own end');
  const noGrace = args(event({ type: 'BILLING_ISSUE', expiration_at_ms: 1601319047000, grace_period_expiration_at_ms: null }));
  eq(noGrace.p_period_ends_at, new Date(1601319047000).toISOString(), 'no grace period: ends at expiration');
  eq(args(event({ type: 'BILLING_ISSUE', expiration_at_ms: null, grace_period_expiration_at_ms: null })).p_period_ends_at,
    null, 'a billing issue is never lifetime');
  eq(args(event({ type: 'EXPIRATION', expiration_at_ms: null })).p_period_ends_at, null, 'expiry is never lifetime');
  eq(args(event({ environment: 'SANDBOX' })).p_environment, 'sandbox', 'sandbox');
  eq(args(event({ store: 'RC_BILLING' })).p_store, 'rc_billing', 'web billing');
  eq(args(event({ store: undefined })).p_store, null, 'store is "sometimes"');
});

Deno.test('parse: refund sample (no api_version in the docs sample) is accepted as a refund', () => {
  const r = parseWebhook({
    event: {
      event_timestamp_ms: 1601337615995, product_id: 'roxy_supporter_monthly:monthly',
      purchased_at_ms: 1601258901000, expiration_at_ms: 1601336705000, environment: 'PRODUCTION',
      entitlement_ids: [SUPPORTER_ENTITLEMENT], transaction_id: 'GPA.1', original_transaction_id: 'GPA.1',
      app_user_id: U1, aliases: [U1], original_app_user_id: U1, cancel_reason: 'CUSTOMER_SUPPORT',
      price: -4.99, store: 'PLAY_STORE', type: 'CANCELLATION', id: 'refund-1',
    },
  });
  ok(r.ok, 'refund rejected');
  if (r.ok) eq([r.args.p_effect, r.args.p_period_ends_at], ['refund', new Date(1601336705000).toISOString()], 'refund');
});

Deno.test('parse: TRANSFER (docs sample) carries destination and sources', () => {
  const t = args({
    app_id: '1234567890', event_timestamp_ms: 1700000000000, id: 'CD489E0E-5D52-4E03-966B-A7F17788E432',
    store: 'PLAY_STORE', transferred_from: [ANON, U2], transferred_to: [U1], type: 'TRANSFER',
    environment: 'PRODUCTION',
  });
  eq([t.p_effect, t.p_user_id, t.p_from_user_ids, t.p_environment], ['transfer', U1, [U2], 'production'], 'transfer');
  const noDest = args({ event_timestamp_ms: 1700000000000, id: 't2', type: 'TRANSFER', transferred_from: [U2], transferred_to: [ANON] });
  eq([noDest.p_user_id, noDest.p_environment], [null, null], 'anonymous destination');
  const same = args({ event_timestamp_ms: 1700000000000, id: 't3', type: 'TRANSFER', transferred_from: [U1], transferred_to: [U1] });
  eq(same.p_from_user_ids, [], 'a member is never her own source');
});

Deno.test('parse: TEST event is logged even with RC\'s random ids', () => {
  const t = args(event({ type: 'TEST', app_user_id: 'test-user', aliases: ['test-user'], original_app_user_id: 'test-user' }));
  eq([t.p_effect, t.p_user_id], ['log', null], 'TEST');
});

Deno.test('parse: malformed envelopes are rejected', () => {
  rejects(null, 'null');
  rejects('INITIAL_PURCHASE', 'string');
  rejects({}, 'no event');
  rejects({ event: [] }, 'event is an array');
  rejects(body(event(), '2.0'), 'unknown api major version');
  rejects(body(event({ id: '' })), 'empty id');
  rejects(body(event({ id: 'x'.repeat(129) })), 'id too long');
  rejects(body(event({ id: 7 })), 'numeric id');
  rejects(body(event({ type: 'initial purchase' })), 'type shape');
  rejects(body(event({ event_timestamp_ms: '1658726378679' })), 'timestamp as string');
  rejects(body(event({ event_timestamp_ms: -1 })), 'negative timestamp');
  rejects(body(event({ event_timestamp_ms: 1.5 })), 'fractional timestamp');
  rejects(body(event({ environment: 'STAGING' })), 'state event, unknown environment');
  rejects(body(event({ environment: undefined })), 'state event, no environment');
  rejects(body(event({ expiration_at_ms: undefined })), 'state event, expiration missing (not null)');
  rejects(body(event({ expiration_at_ms: 'soon' })), 'state event, expiration not a number');
  rejects(body(event({ type: 'BILLING_ISSUE', grace_period_expiration_at_ms: 'later' })), 'grace not a number');
  rejects(body({ event_timestamp_ms: 1, id: 't', type: 'TRANSFER', transferred_from: U2, transferred_to: [U1] }), 'transfer from not an array');
  rejects(body({ event_timestamp_ms: 1, id: 't', type: 'TRANSFER', transferred_from: [U2] }), 'transfer to missing');
  rejects(body(event({ original_transaction_id: undefined, product_id: undefined })), 'state event names no subscription');
});

Deno.test('parse: a state event keyed by product alone is accepted; an informational one needs no key', () => {
  eq(args(event({ original_transaction_id: undefined })).p_product_id, 'roxy_supporter_monthly:monthly', 'product only');
  eq(args(event({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', original_transaction_id: undefined,
                  product_id: undefined })).p_effect, 'cancel', 'cancel without a key');
});

Deno.test('parse: a log-only event with an odd environment is still logged', () => {
  eq(args(event({ type: 'SUBSCRIPTION_PAUSED', environment: 'STAGING' })).p_environment, null, 'lenient for log');
});

// ── handleRevenueCatWebhook ───────────────────────────────────────────────

type RpcResult = { data: string | null; error: { code?: string; message: string } | null };

function harness(result: RpcResult, rejectResult: RpcResult = { data: 'recorded', error: null }) {
  const calls: ApplyArgs[] = [];
  const rejected: RejectArgs[] = [];
  const logs: string[] = [];
  const apply: ApplyFn = async (a) => { calls.push(a); return result; };
  const reject: RejectFn = async (a) => { rejected.push(a); return rejectResult; };
  const log = (level: string, msg: string, fields: Record<string, unknown>) => {
    logs.push(`${level} ${msg} ${JSON.stringify(fields)}`);
  };
  return { calls, rejected, logs, apply, reject, log };
}
const post = (b: unknown, auth: string | null = SECRET, method = 'POST') =>
  new Request('https://x.supabase.co/functions/v1/revenuecat-webhook', {
    method,
    headers: auth === null ? {} : { Authorization: auth },
    body: method === 'GET' ? undefined : typeof b === 'string' ? b : JSON.stringify(b),
  });
async function json(res: Response) { return await res.json(); }

Deno.test('handler: missing or wrong secret is 401, the body is never read, nothing is applied', async () => {
  const h = harness({ data: 'applied', error: null });
  const missing = post(body(event()), null);
  const wrong = post(body(event()), 'Bearer wrong-secret-0123456789');
  eq((await handleRevenueCatWebhook(missing, { secret: SECRET, ...h })).status, 401, 'missing');
  eq((await handleRevenueCatWebhook(wrong, { secret: SECRET, ...h })).status, 401, 'wrong');
  eq([missing.bodyUsed, wrong.bodyUsed], [false, false], 'body read before auth');
  eq(h.calls.length, 0, 'apply was called');
});

Deno.test('handler: no secret in env is 503 for everyone, before any body is read', async () => {
  const h = harness({ data: 'applied', error: null });
  const unset = post(body(event()));
  const empty = post(body(event()), '');
  eq((await handleRevenueCatWebhook(unset, { secret: undefined, ...h })).status, 503, 'unset');
  eq((await handleRevenueCatWebhook(empty, { secret: '', ...h })).status, 503, 'empty');
  eq([unset.bodyUsed, empty.bodyUsed], [false, false], 'body read before the config check');
  eq(h.calls.length, 0, 'apply was called');
  ok(h.logs.every((l) => l.startsWith('error ')), 'misconfiguration not logged as an error');
});

Deno.test('handler: wrong method 405; a body with no event id/type to record is 400', async () => {
  const h = harness({ data: 'applied', error: null });
  eq((await handleRevenueCatWebhook(post(null, SECRET, 'GET'), { secret: SECRET, ...h })).status, 405, 'GET');
  eq((await handleRevenueCatWebhook(post('{not json'), { secret: SECRET, ...h })).status, 400, 'not JSON');
  eq((await handleRevenueCatWebhook(post({ hello: 'world' }), { secret: SECRET, ...h })).status, 400, 'no event');
  eq((await handleRevenueCatWebhook(post(body(event({ id: undefined }))), { secret: SECRET, ...h })).status, 400, 'no id');
  eq((await handleRevenueCatWebhook(post(body(event({ type: 'not a type' }))), { secret: SECRET, ...h })).status, 400,
    'unusable type');
  eq([h.calls.length, h.rejected.length], [0, 0], 'apply or reject was called');
});

// RevenueCat counts anything but 200 as a failure, retries the SAME payload
// (same id, same event_timestamp_ms) 5 times over ~80 min, then stops for
// good (W). A payload we refuse cannot get better on a retry, so a 4xx would
// only burn the retries and leave support nothing: record it and answer 200.
Deno.test('handler: a well-formed event we refuse is recorded (hashed id) and answered 200', async () => {
  const cases: [string, unknown][] = [
    ['event.environment', body(event({ environment: undefined }))],
    ['event.expiration_at_ms', body(event({ expiration_at_ms: undefined }))],
    ['event.original_transaction_id', body(event({ original_transaction_id: undefined, product_id: undefined }))],
    ['event.event_timestamp_ms', body(event({ event_timestamp_ms: '1658726378679' }))],
    ['api_version', body(event(), '2.0')],
  ];
  for (const [reason, payload] of cases) {
    const h = harness({ data: 'applied', error: null });
    const res = await handleRevenueCatWebhook(post(payload), { secret: SECRET, ...h });
    eq(res.status, 200, `${reason} status`);
    eq((await json(res)).data, { result: 'rejected', reason }, `${reason} body`);
    eq(h.calls.length, 0, `${reason}: apply was called`);
    eq(h.rejected, [{
      p_event_id: '12345678-1234-1234-1234-123456789012',
      p_event_type: 'INITIAL_PURCHASE',
      p_reason: reason,
      p_app_user_id_hash: U1_HASH,
    }], `${reason} recorded`);
    for (const line of h.logs) ok(!line.includes(U1) && !line.includes(EMAIL), `PII in log: ${line}`);
  }
});

Deno.test('handler: a refused TRANSFER is traced under its destination member', async () => {
  const h = harness({ data: 'applied', error: null });
  const res = await handleRevenueCatWebhook(
    post(body({ event_timestamp_ms: 1700000000000, id: 't-bad', type: 'TRANSFER', transferred_from: U2, transferred_to: [U1] })),
    { secret: SECRET, ...h },
  );
  eq(res.status, 200, 'status');
  eq(h.rejected, [{ p_event_id: 't-bad', p_event_type: 'TRANSFER', p_reason: 'event.transferred_from', p_app_user_id_hash: U1_HASH }],
    'recorded');
});

Deno.test('handler: a refused event naming no id at all is recorded with no hash', async () => {
  const h = harness({ data: 'applied', error: null });
  const ev = event({ app_user_id: undefined, aliases: undefined, original_app_user_id: undefined, environment: undefined });
  eq((await handleRevenueCatWebhook(post(body(ev)), { secret: SECRET, ...h })).status, 200, 'status');
  eq(h.rejected.map((r) => r.p_app_user_id_hash), [null], 'no hash');
});

Deno.test('handler: the trace hashes HER member id when the event carries one, so support can find it', async () => {
  // Bought anonymously, aliased to her account afterwards; that account is gone (unknown_user).
  const h = harness({ data: 'unknown_user', error: null });
  await handleRevenueCatWebhook(
    post(body(event({ app_user_id: ANON, aliases: [ANON, U1.toUpperCase()], original_app_user_id: ANON }))),
    { secret: SECRET, ...h },
  );
  eq(h.rejected.map((r) => r.p_app_user_id_hash), [U1_HASH], 'hash of her lower-cased uuid, not of the anonymous id');
});

Deno.test('handler: the rejection could not be recorded → 500, so RevenueCat retries', async () => {
  const h = harness({ data: 'applied', error: null }, { data: null, error: { code: '08006', message: `down for ${U1}` } });
  const res = await handleRevenueCatWebhook(post(body(event({ environment: undefined }))), { secret: SECRET, ...h });
  eq(res.status, 500, 'status');
  eq(h.rejected.length, 1, 'tried once');
  for (const line of h.logs) ok(!line.includes(U1), `PII in log: ${line}`);
});

Deno.test('handler: unknown_user is 200 and leaves a hashed trace for support', async () => {
  const h = harness({ data: 'unknown_user', error: null });
  const res = await handleRevenueCatWebhook(
    post(body(event({ app_user_id: ANON, aliases: [ANON], original_app_user_id: ANON }))),
    { secret: SECRET, ...h },
  );
  eq([res.status, (await json(res)).data], [200, { result: 'unknown_user' }], 'response');
  eq(h.rejected, [{
    p_event_id: '12345678-1234-1234-1234-123456789012',
    p_event_type: 'INITIAL_PURCHASE',
    p_reason: 'unknown_user',
    p_app_user_id_hash: ANON_HASH,
  }], 'recorded');
  for (const line of h.logs) ok(!line.includes(ANON), `PII in log: ${line}`);
});

Deno.test('handler: unknown_user stays 200 even when its trace fails (the event is already logged)', async () => {
  const h = harness({ data: 'unknown_user', error: null }, { data: null, error: { code: '08006', message: 'down' } });
  const res = await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
  eq(res.status, 200, 'status');
  ok(h.logs.some((l) => l.startsWith('error ')), 'the failed trace was not logged');
});

Deno.test('handler: applied / duplicate / stale / logged leave no rejection row', async () => {
  for (const result of ['applied', 'duplicate', 'stale', 'logged']) {
    const h = harness({ data: result, error: null });
    await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
    eq(h.rejected.length, 0, result);
  }
});

Deno.test('handler: applied, duplicate, stale and logged are all 200 (RC must not retry them)', async () => {
  for (const result of ['applied', 'duplicate', 'stale', 'logged', 'unknown_user']) {
    const h = harness({ data: result, error: null });
    const res = await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
    eq(res.status, 200, result);
    eq((await json(res)).data, { result }, `${result} body`);
    eq(h.calls.length, 1, `${result} apply calls`);
  }
});

Deno.test('handler: a replayed delivery reaches apply with the same id and answers duplicate', async () => {
  const h = harness({ data: 'duplicate', error: null });
  const res = await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
  eq([res.status, (await json(res)).data.result, h.calls[0].p_event_id],
    [200, 'duplicate', '12345678-1234-1234-1234-123456789012'], 'replay');
});

Deno.test('handler: a database error is 500 so RC retries, and logs carry no member id', async () => {
  const h = harness({ data: null, error: { code: '40P01', message: `deadlock while applying for ${U1}` } });
  const res = await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
  eq(res.status, 500, 'status');
  ok(h.logs.some((l) => l.startsWith('error ')), 'failure not logged at error level');
  for (const line of h.logs) {
    ok(!line.includes(U1) && !line.includes(EMAIL) && !line.includes(ANON), `PII in log: ${line}`);
  }
});

Deno.test('handler: success logs carry no member id either', async () => {
  const h = harness({ data: 'applied', error: null });
  await handleRevenueCatWebhook(post(body(event())), { secret: SECRET, ...h });
  for (const line of h.logs) ok(!line.includes(U1) && !line.includes(EMAIL), `PII in log: ${line}`);
});
