// makeClient must survive Management API throttling (HTTP 429) and must not retry anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../lib/supabase-mgmt.mjs';

const REF = 'abcdefghijklmnopqrst';
const resp = (status, body = '[]', headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

test('retries 429 with backoff, then succeeds', async () => {
  const seq = [resp(429), resp(429, '', { 'retry-after': '1' }), resp(200, '[{"n":1}]')];
  const waits = [];
  const c = makeClient({ ref: REF, token: 't', fetchImpl: async () => seq.shift(), sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(await c.query('select 1'), [{ n: 1 }]);
  assert.deepEqual(waits, [2000, 1000]);
});

test('does not retry other errors', async () => {
  let calls = 0;
  const c = makeClient({ ref: REF, token: 't', fetchImpl: async () => { calls++; return resp(500, 'boom'); }, sleep: async () => {} });
  await assert.rejects(c.query('select 1'), /HTTP 500/);
  assert.equal(calls, 1);
});

test('gives up after maxRetries and reports the 429', async () => {
  let calls = 0;
  const c = makeClient({ ref: REF, token: 't', maxRetries: 2, fetchImpl: async () => { calls++; return resp(429, 'slow down'); }, sleep: async () => {} });
  await assert.rejects(c.get('/x'), /HTTP 429/);
  assert.equal(calls, 3);
});
