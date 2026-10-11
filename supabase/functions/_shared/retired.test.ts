// Run from supabase/functions/:  deno test --no-check _shared/retired.test.ts
import { goneResponse } from './retired.ts';

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

Deno.test('retired endpoint: POST/GET get 410 with a JSON reason and no-store', async () => {
  for (const method of ['POST', 'GET']) {
    const res = goneResponse(new Request('https://x/functions/v1/livekit-token', { method }), 'livekit-token', 'Video calls use Daily.');
    eq(res.status, 410, `${method} status`);
    eq(res.headers.get('Cache-Control'), 'no-store', `${method} cache`);
    const body = await res.json();
    eq(body.success, false, `${method} success`);
    eq(body.retired, 'livekit-token', `${method} name`);
    eq(body.error, 'Video calls use Daily.', `${method} message`);
  }
});

Deno.test('retired endpoint: CORS preflight still succeeds so browsers see the 410', () => {
  const res = goneResponse(new Request('https://x/functions/v1/request-invite-code', { method: 'OPTIONS' }), 'request-invite-code', 'x');
  eq(res.status, 204, 'preflight');
  eq(res.headers.get('Access-Control-Allow-Origin'), '*', 'cors');
});
