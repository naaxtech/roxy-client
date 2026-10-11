// Service-to-service bearer check (cron / pg_net callers).
//
// Run from supabase/functions/:
//   deno test --no-check --allow-env _shared/serviceAuth.test.ts
//
// Why: release-payout, process-refunds and auto-complete-events run with
// verify_jwt = false and checked `authHeader.includes(SERVICE_ROLE_KEY)`.
// With the env var unset that is `includes(undefined)` -> "undefined" is
// matched by any header containing the word, and with it set to '' it is
// `includes('')` -> true for EVERY caller. release-payout with no event_id
// releases every eligible payout. These tests pin the fail-closed behaviour.

import { bearerToken, constantTimeEqual, isServiceRequest } from './serviceAuth.ts';

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const KEY = 'service-role-key-for-tests-0123456789';
const req = (auth?: string) =>
  new Request('https://x.supabase.co/functions/v1/release-payout', {
    method: 'POST',
    headers: auth === undefined ? {} : { Authorization: auth },
  });

Deno.test('constantTimeEqual: equal, unequal, different length', () => {
  eq(constantTimeEqual('abc', 'abc'), true, 'same');
  eq(constantTimeEqual('abc', 'abd'), false, 'last char differs');
  eq(constantTimeEqual('abc', 'abcd'), false, 'longer');
  eq(constantTimeEqual('', ''), true, 'both empty (callers must reject empty keys themselves)');
});

Deno.test('bearerToken: only a well-formed Bearer header yields a token', () => {
  eq(bearerToken(`Bearer ${KEY}`), KEY, 'Bearer');
  eq(bearerToken(`bearer ${KEY}`), KEY, 'scheme is case-insensitive');
  eq(bearerToken(KEY), null, 'raw key without scheme');
  eq(bearerToken(`Basic ${KEY}`), null, 'other scheme');
  eq(bearerToken('Bearer '), null, 'empty token');
  eq(bearerToken(null), null, 'missing header');
});

Deno.test('isServiceRequest: exact service key passes', () => {
  eq(isServiceRequest(req(`Bearer ${KEY}`), KEY), true, 'exact key');
});

Deno.test('isServiceRequest: EMPTY or missing env key rejects everyone', () => {
  eq(isServiceRequest(req('Bearer '), ''), false, 'empty key, empty bearer');
  eq(isServiceRequest(req('Bearer anything'), ''), false, 'empty key, any bearer');
  eq(isServiceRequest(req('Bearer undefined'), undefined), false, 'unset key, literal "undefined"');
  eq(isServiceRequest(req(), undefined), false, 'unset key, no header');
});

Deno.test('isServiceRequest: substring / prefix / wrong scheme no longer pass', () => {
  eq(isServiceRequest(req(`Bearer x${KEY}x`), KEY), false, 'key embedded in a longer token (old includes())');
  eq(isServiceRequest(req(`Bearer ${KEY.slice(0, -1)}`), KEY), false, 'prefix of the key');
  eq(isServiceRequest(req(KEY), KEY), false, 'no Bearer scheme');
  eq(isServiceRequest(req(), KEY), false, 'no header');
  eq(isServiceRequest(req('Bearer anon-key'), KEY), false, 'another key');
});

Deno.test('isServiceRequest: reads SUPABASE_SERVICE_ROLE_KEY when no key is passed', () => {
  const prev = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try {
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY);
    eq(isServiceRequest(req(`Bearer ${KEY}`)), true, 'env key matches');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', '');
    eq(isServiceRequest(req('Bearer ')), false, 'env key empty');
  } finally {
    if (prev === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', prev);
  }
});
