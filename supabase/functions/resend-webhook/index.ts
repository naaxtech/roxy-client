// supabase/functions/resend-webhook/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Verify Svix signature (Resend uses Svix for webhook delivery)
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return errorResponse('Missing Svix headers', 400);
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!webhookSecret) return errorResponse('RESEND_WEBHOOK_SECRET not set', 500);

  const body = await req.text();

  // Verify signature using Svix algorithm
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes = Uint8Array.from(
    atob(webhookSecret.replace('whsec_', '')),
    c => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
  if (!signatures.includes(expectedSig)) {
    return errorResponse('Invalid signature', 400);
  }

  let payload: { type: string; data: { email_id: string; [key: string]: unknown } };
  try { payload = JSON.parse(body); } catch { return errorResponse('Invalid JSON', 400); }

  const supabase = getSupabaseClient();

  // Find email_queue row by resend_message_id
  const { data: queueRow } = await supabase
    .from('email_queue')
    .select('id')
    .eq('resend_message_id', payload.data.email_id)
    .maybeSingle();

  if (!queueRow) return successResponse({ received: true, skipped: true });

  const eventType = payload.type.replace('email.', ''); // 'delivered', 'bounced', etc.
  const validTypes = ['delivered', 'bounced', 'complained', 'opened', 'clicked'];
  if (!validTypes.includes(eventType)) return successResponse({ received: true, unknown_type: true });

  // Strip PII from raw payload before storing
  const safePayload = {
    type: payload.type,
    email_id: payload.data.email_id,
    created_at: (payload.data as any).created_at,
  };

  await supabase.from('email_delivery_events').insert({
    email_queue_id: queueRow.id,
    resend_message_id: payload.data.email_id,
    event_type: eventType,
    raw_payload: safePayload,
  });

  // Flag bounces/complaints for staff
  if (eventType === 'bounced' || eventType === 'complained') {
    await supabase
      .from('email_queue')
      .update({ last_error: `Email ${eventType} — check recipient address` })
      .eq('id', queueRow.id);
  }

  return successResponse({ received: true });
});
