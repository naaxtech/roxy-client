// Regression test for verifyJWT().
//
// Lives in _shared/ so the Supabase CLI does not treat it as a deployable
// function (directories and files under an underscore-prefixed folder are not
// deployed).
//
// Run from supabase/functions/:
//   deno test --allow-net --allow-env _shared/auth.test.ts
//
// Why this exists: verifyJWT used to base64-decode the payload and trust `sub`,
// on the assumption that the API gateway had already checked the signature.
// Gateway verification was simultaneously disabled for ~22 functions, so a
// caller could mint `<header>.<payload naming any user>.<garbage>` and be
// treated as that user by gdpr-export, gdpr-delete and kyc-create-session.
// If anyone reverts verifyJWT to reading claims without verifying them, the
// forged-token cases below fail.

// Asserted locally rather than with std/assert: every other module here is
// pinned to a URL specifier, and a test has no business adding another one.
function assertEquals(actual: { userId: string } | null, expected: { userId: string } | null) {
  const show = (v: { userId: string } | null) => (v === null ? 'null' : `{ userId: ${v.userId} }`);
  if (show(actual) !== show(expected)) {
    throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
  }
}

const VICTIM = '11111111-2222-3333-4444-555555555555';
const ATTACKER = '99999999-8888-7777-6666-555555555555';
const KID = 'test-signing-key';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (value: unknown) => b64url(enc.encode(JSON.stringify(value)));

const KEY_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

// The project's signing key, and an unrelated key an attacker controls.
const projectKey = await crypto.subtle.generateKey(KEY_PARAMS, true, ['sign', 'verify']);
const attackerKey = await crypto.subtle.generateKey(KEY_PARAMS, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', projectKey.publicKey);

// Stand in for the project's Auth origin: serves a real JWKS, and refuses the
// symmetric-fallback round trip so no forgery can pass on that path either.
const abort = new AbortController();
const server = Deno.serve(
  { port: 0, signal: abort.signal, onListen: () => {} },
  (req) =>
    new URL(req.url).pathname.endsWith('/.well-known/jwks.json')
      ? Response.json({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] })
      : Response.json({ msg: 'invalid JWT' }, { status: 401 }),
);
const origin = `http://localhost:${(server.addr as Deno.NetAddr).port}`;

// Must be set before the first verifyJWT call, which builds the cached client.
Deno.env.set('SUPABASE_URL', origin);
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');

const { verifyJWT } = await import('./auth.ts');

const now = () => Math.floor(Date.now() / 1000);

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: VICTIM,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${origin}/auth/v1`,
    iat: now(),
    exp: now() + 3600,
    ...overrides,
  };
}

async function sign(payload: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const header = b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID });
  const body = b64urlJson(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(SIGN_PARAMS, key, enc.encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(signature)}`;
}

const request = (token: string | null) =>
  new Request('https://roxy.test/functions/v1/gdpr-export', {
    method: 'POST',
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });

Deno.test('verifyJWT accepts a genuinely signed token', async () => {
  const result = await verifyJWT(request(await sign(claims(), projectKey.privateKey)));
  assertEquals(result, { userId: VICTIM });
});

Deno.test('verifyJWT rejects forged tokens', async (t) => {
  const unsignedPayload = b64urlJson(claims());

  const forgeries: Array<[string, string]> = [
    // The original proof of concept: garbage header and signature, payload
    // hand-written to name the victim.
    ['garbage header and signature', `aaa.${unsignedPayload}.bbb`],
    // The same attack with a well-formed header, so it survives any check that
    // inspects the token's shape instead of its signature.
    [
      'well-formed header, garbage signature',
      `${b64urlJson({ alg: 'ES256', typ: 'JWT', kid: KID })}.${unsignedPayload}.bbbb`,
    ],
    ['alg:none and no signature', `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${unsignedPayload}.`],
    ['signed with an attacker-controlled key', await sign(claims(), attackerKey.privateKey)],
    ['not a JWT at all', 'not-a-jwt'],
  ];

  // A real token whose payload was swapped for the victim's after signing.
  const attackerToken = await sign(claims({ sub: ATTACKER }), projectKey.privateKey);
  const [header, , signature] = attackerToken.split('.');
  forgeries.push(['valid signature over a swapped payload', `${header}.${unsignedPayload}.${signature}`]);

  for (const [name, token] of forgeries) {
    await t.step(name, async () => {
      assertEquals(await verifyJWT(request(token)), null);
    });
  }
});

Deno.test('verifyJWT rejects correctly signed tokens that must not act as a user', async (t) => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    ['expired', claims({ exp: now() - 60, iat: now() - 3600 })],
    ['anon role', claims({ role: 'anon' })],
    ['service_role', claims({ role: 'service_role' })],
    ['non-uuid sub', claims({ sub: 'not-a-uuid' })],
  ];

  for (const [name, payload] of rejected) {
    await t.step(name, async () => {
      const token = await sign(payload, projectKey.privateKey);
      assertEquals(await verifyJWT(request(token)), null);
    });
  }
});

Deno.test('verifyJWT rejects a request with no bearer token', async () => {
  assertEquals(await verifyJWT(request(null)), null);
});

globalThis.addEventListener('unload', () => abort.abort());
