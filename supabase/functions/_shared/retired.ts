// Retired endpoints answer 410 Gone (tests: _shared/retired.test.ts).
//
// House rule: an endpoint an older installed build may still call is never
// deleted; it becomes a commented no-op. 410 (not 404/401) tells that build
// "this is gone on purpose", does no work, reads no body, touches no data,
// and logs nothing about the caller.
import { corsHeaders } from './cors.ts';

export function goneResponse(req: Request, name: string, message: string): Response {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  return new Response(
    JSON.stringify({ success: false, data: null, error: message, retired: name }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}
