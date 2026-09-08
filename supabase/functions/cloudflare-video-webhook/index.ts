import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const CF_WEBHOOK_SECRET = Deno.env.get('CLOUDFLARE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Verify Cloudflare webhook signature — fail CLOSED: an unset secret must
  // reject every request, not skip verification (previously failed open).
  // Static-string comparison against a pre-shared secret, not Cloudflare's
  // HMAC scheme; tracked as its own follow-up in _kernel/INBOX.md so the
  // stronger verification goes through research-protocol rather than a
  // guessed crypto implementation here.
  if (!CF_WEBHOOK_SECRET) {
    return errorResponse('Webhook not configured', 401);
  }
  const sig = req.headers.get('Webhook-Signature') ?? '';
  if (sig !== CF_WEBHOOK_SECRET) {
    return errorResponse('Invalid webhook signature', 401);
  }

  const body = await req.json();
  const { uid: videoId, status, thumbnail, duration, meta } = body;

  // Only process 'ready' events
  if (status?.state !== 'ready') return successResponse({ received: true });

  // meta.name is the postId set during upload
  const postId = meta?.name;
  if (!postId) return errorResponse('No postId in meta', 400);

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
