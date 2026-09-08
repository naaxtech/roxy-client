// kyc-webhook
//
// The authoritative source of a verification outcome. The client's own report
// of "I passed" is never trusted -- it is trivially forged, and it is the whole
// reason the vendor signs this callback.
//
// Deploy with --no-verify-jwt: the vendor cannot present a Supabase JWT.
// The HMAC signature is the authentication.

import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { getKycAdapter } from '../_shared/kyc.ts';

/** Criterion keys satisfied by a passing verification (seeded in 071). */
const KYC_CRITERIA = ['gov_id', 'kyc_liveness'];

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  let adapter;
  try {
    adapter = getKycAdapter();
  } catch {
    return errorResponse('Not configured.', 503);
  }

  // Read once, as text. Parsing and re-stringifying reorders keys and changes
  // whitespace, and the signature stops matching -- the single most common way
  // to get this wrong.
  const rawBody = await req.text();

  if (!(await adapter.verifyWebhook(rawBody, req.headers))) {
    // Deliberately terse. A detailed rejection tells a forger which check failed.
    return errorResponse('Invalid signature.', 401);
  }

  let decision;
  try {
    decision = adapter.parseWebhook(rawBody);
  } catch (err) {
    console.error('kyc-webhook parse failed', String(err));
    return errorResponse('Unprocessable payload.', 422);
  }

  const supabase = getSupabaseClient();

  // REPLAY DEFENCE. Read first, then move the row only if it is still pending.
  // This is the control that actually stops a captured "approved" callback from
  // being posted again -- the timestamp check in the adapter cannot, because the
  // vendor signs the body alone and an attacker is free to rewrite the header.
  const { data: existing, error: readError } = await supabase
    .from('identity_verifications')
    .select('application_id, status')
    .eq('provider', adapter.provider)
    .eq('provider_session_id', decision.providerSessionId)
    .maybeSingle();

  if (readError) {
    console.error('kyc-webhook read failed', readError.code);
    return errorResponse('Could not record outcome.', 500);
  }

  // A session we never created. Acknowledged so the vendor stops retrying, but
  // nothing is written.
  if (!existing) return successResponse({ received: true, matched: false });

  const isTerminal = existing.status !== 'pending';

  if (isTerminal && existing.status !== decision.status) {
    // Already decided, and this callback disagrees. Either a replay of an older
    // message or genuine out-of-order delivery. Either way the first terminal
    // decision stands -- letting a late 'approved' overwrite a 'declined' is
    // exactly the escalation this guard exists to prevent.
    console.warn(
      `kyc-webhook ignored: session already ${existing.status}, received ${decision.status}`,
    );
    return successResponse({ received: true, matched: false });
  }

  if (!isTerminal) {
    const { error: updateError } = await supabase
      .from('identity_verifications')
      .update({
        status: decision.status,
        duplicate_signal: decision.duplicateSignal,
        decided_at: new Date().toISOString(),
      })
      .eq('provider', adapter.provider)
      .eq('provider_session_id', decision.providerSessionId)
      .eq('status', 'pending');   // atomic: two concurrent deliveries cannot both win

    if (updateError) {
      console.error('kyc-webhook update failed', updateError.code);
      return errorResponse('Could not record outcome.', 500);
    }
  }
  // When isTerminal and the status matches, we fall through deliberately rather
  // than returning early: a previous delivery may have set the status and then
  // failed on the criteria upsert below, and the vendor's retry is the only
  // thing that will award the points. The upsert is idempotent, so repeating it
  // is free.

  const applicationId = existing.application_id ?? decision.applicationId;

  if (decision.status === 'approved' && applicationId) {
    // Award the criteria this verification satisfies. Resolved by key rather
    // than hardcoded id so the points and labels stay editable from the studio.
    const { data: criteria } = await supabase
      .from('verification_criteria')
      .select('id, key')
      .in('key', KYC_CRITERIA)
      .is('community_id', null)
      .eq('is_active', true);

    if (criteria?.length) {
      const { error: metError } = await supabase
        .from('application_criteria_met')
        .upsert(
          criteria.map((c: { id: string }) => ({
            application_id: applicationId,
            criterion_id: c.id,
            evidence_ref: decision.providerSessionId,
          })),
          { onConflict: 'application_id,criterion_id' },
        );

      if (metError) {
        // The verification is recorded; only the scoring failed. Surfacing a
        // 500 makes the vendor retry, which is the correct outcome here.
        console.error('kyc-webhook criteria upsert failed', metError.code);
        return errorResponse('Could not record outcome.', 500);
      }
    }
  }

  // A declined check never auto-rejects the application. A human decides, and
  // a real person can fail a liveness check for reasons that have nothing to do
  // with whether they should be here.
  return successResponse({ received: true, matched: true });
});
