import { corsHeaders } from './cors.ts';

export function errorResponse(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: message }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

export function successResponse<T>(data: T, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}
