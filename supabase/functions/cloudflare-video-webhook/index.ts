// supabase/functions/cloudflare-video-webhook/index.ts
// Called by Cloudflare Stream when an upload finishes processing.
// Auth: Cloudflare's webhook signature, NOT a Supabase JWT (verify_jwt = false
// in config.toml). Verification lives in _shared/webhookSignatures.ts (tested):
//   Webhook-Signature: time=<unix>,sig1=<hex HMAC-SHA256(secret, time + '.' + rawBody)>
// CLOUDFLARE_WEBHOOK_SECRET is the signing secret returned when the webhook
// is created/retrieved (PUT/GET accounts/<id>/stream/webhook). Events older
// than 5 minutes are discarded (replay window).
//
// Before this change the whole header was compared to the secret as a static
// string, which no genuine Cloudflare delivery can ever match (and, had the
// secret leaked, anyone could set any post's video_url).
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { verifyCloudflareStreamSignature } from '../_shared/webhookSignatures.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_UID = /^[0-9a-f]{32}$/i;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Raw body first: every byte is part of the signed string.
  const rawBody = await req.text();
  const ok = await verifyCloudflareStreamSignature({
    secret: Deno.env.get('CLOUDFLARE_WEBHOOK_SECRET'),
    header: req.headers.get('Webhook-Signature'),
    rawBody,
  });
  if (!ok) return errorResponse('Invalid webhook signature', 401);

  let body: {
    uid?: string;
    status?: { state?: string };
    thumbnail?: string;
    duration?: number;
    meta?: { name?: string };
  };
  try { body = JSON.parse(rawBody); } catch { return errorResponse('Invalid JSON', 400); }
  const { uid: videoId, status, thumbnail, duration, meta } = body;

  // Only process 'ready' events
  if (status?.state !== 'ready') return successResponse({ received: true });

  // meta.name is the postId set during upload
  const postId = meta?.name;
  if (!postId || !UUID.test(postId)) return errorResponse('No postId in meta', 400);
  if (!videoId || !VIDEO_UID.test(videoId)) return errorResponse('No video uid', 400);

  const supabase = getSupabaseClient();

  const CF_CUSTOMER = Deno.env.get('CF_CUSTOMER_SUBDOMAIN') ?? '';
  const videoUrl = `https://customer-${CF_CUSTOMER}.cloudflarestream.com/${videoId}/manifest/video.m3u8`;

  await supabase.from('posts').update({
    video_url: videoUrl,
    video_thumbnail_url: thumbnail ?? null,
    video_duration_secs: duration ? Math.round(duration) : null,
  }).eq('id', postId);

  return successResponse({ updated: postId });
});
