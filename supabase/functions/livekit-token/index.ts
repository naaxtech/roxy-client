import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function signLiveKitToken(
  apiKey: string,
  apiSecret: string,
  room: string,
  identity: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: identity,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 3600,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
  };

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const message = `${b64url(header)}.${b64url(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${message}.${sig}`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { room_name, identity } = body;
  if (!room_name || !identity) return errorResponse('room_name and identity required', 400);

  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  const serverUrl = Deno.env.get('LIVEKIT_SERVER_URL');

  if (!apiKey || !apiSecret || !serverUrl) {
    return errorResponse('LiveKit not configured — set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SERVER_URL', 503);
  }

  const token = await signLiveKitToken(apiKey, apiSecret, room_name, identity);

  return successResponse({ token, server_url: serverUrl });
});
