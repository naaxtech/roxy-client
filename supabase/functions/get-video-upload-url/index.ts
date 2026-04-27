import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const CF_ACCOUNT_ID = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') ?? '';
const CF_API_TOKEN  = Deno.env.get('CLOUDFLARE_STREAM_API_TOKEN') ?? '';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const authResult = await verifyJWT(req);
  if (!authResult.valid) return errorResponse('Unauthorized', 401);

  const { postId, maxDurationSeconds = 180 } = await req.json();
  if (!postId) return errorResponse('postId required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  if (DEV_MOCK) {
    return successResponse({
      uploadURL: `https://upload.videodelivery.net/mock-${postId}`,
      videoId: `mock-${postId}`,
    });
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '0',
        'Upload-Metadata': [
          `maxDurationSeconds ${btoa(String(maxDurationSeconds))}`,
          `name ${btoa(postId)}`,
        ].join(','),
      },
    }
  );

  if (!res.ok) {
    return errorResponse('Failed to get upload URL from Cloudflare', 502);
  }

  const uploadURL = res.headers.get('Location');
  const videoId   = res.headers.get('Stream-Media-Id');

  if (!uploadURL || !videoId) {
    return errorResponse('Cloudflare did not return upload URL', 502);
  }

  return successResponse({ uploadURL, videoId });
});
