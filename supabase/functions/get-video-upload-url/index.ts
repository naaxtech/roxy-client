import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const CF_ACCOUNT_ID = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') ?? '';
const CF_API_TOKEN  = Deno.env.get('CLOUDFLARE_STREAM_API_TOKEN') ?? '';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Bug fix: verifyJWT is synchronous and returns { userId } | null -- this
  // previously checked a nonexistent `.valid` property, which made every
  // call (valid token or not) either return 401 or throw on `null.valid`.
  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const { postId, maxDurationSeconds = 180, fileSize } = await req.json();
  if (!postId) return errorResponse('postId required', 400);
  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return errorResponse('fileSize (bytes) required', 400);
  }

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
        // Bug fix: this was hardcoded to '0', which per the TUS spec tells
        // Cloudflare the upload is already complete at zero bytes -- the
        // client's subsequent PATCH with real bytes would never match.
        // Upload-Length must be the actual file size, sent by the caller.
        'Upload-Length': String(fileSize),
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
