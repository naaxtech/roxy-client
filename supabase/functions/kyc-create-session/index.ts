// kyc-create-session
//
// Creates a vendor-hosted verification session for the caller's own pending
// application and returns the URL to open. The API key never leaves the server,
// and the applicant's identity documents never reach ours.

import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { getKycAdapter } from '../_shared/kyc.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Not authenticated.', 401);

  const supabase = getSupabaseClient();

  // The application is resolved from the JWT, never from the request body --
  // otherwise anyone could start a verification against someone else's
  // application and attach their own passing result to it.
  const { data: application, error: appError } = await supabase
    .from('membership_applications')
    .select('id, status')
    .eq('auth_user_id', auth.userId)
    .maybeSingle();

  if (appError) {
    console.error('kyc-create-session lookup failed', appError.code);
    return errorResponse('Could not start verification.', 500);
  }
  if (!application) return errorResponse('No application found.', 404);
  if (application.status !== 'pending') {
    return errorResponse('This application has already been decided.', 409);
  }

  let adapter;
  try {
    adapter = getKycAdapter();
  } catch {
    return errorResponse('Identity verification is temporarily unavailable.', 503);
  }

  // GDPR Art. 28(3): no processing through a processor without a contract.
  // Checked BEFORE the vendor is called, because calling it is the disclosure —
  // once her document reaches Didit, refusing to store the result changes
  // nothing about the fact that it was sent.
  const { data: cleared } = await supabase.rpc('processor_is_cleared', {
    p_processor: adapter.provider,
  });
  if (cleared !== true) {
    console.error(`kyc-create-session blocked: no DPA on record for ${adapter.provider}`);
    return errorResponse(
      'Identity checks are paused while we finish a data-protection agreement with our verification partner. Everything else in your application still counts.',
      503,
    );
  }

  // Art. 9(2)(a): explicit consent to process special-category data. The DB
  // triggers in 074 enforce this too — this check exists so she sees a sentence
  // rather than a constraint violation.
  const { data: consented } = await supabase.rpc('has_consent', {
    p_user_id: auth.userId,
    p_purpose: 'identity_verification',
  });
  if (consented !== true) {
    return errorResponse('Please agree to the identity check before starting it.', 428);
  }

  try {
    const redirectUrl = Deno.env.get('KYC_REDIRECT_URL') ?? 'https://roxyhq.com/verified';
    const session = await adapter.createSession(application.id, redirectUrl);

    // Recorded before the applicant is sent onward, so an inbound webhook
    // always has a row to match even if the applicant abandons the flow.
    const { error: insertError } = await supabase
      .from('identity_verifications')
      .upsert(
        {
          auth_user_id: auth.userId,
          application_id: application.id,
          provider: adapter.provider,
          provider_session_id: session.providerSessionId,
          status: 'pending',
        },
        { onConflict: 'provider,provider_session_id' },
      );

    if (insertError) {
      console.error('kyc-create-session insert failed', insertError.code);
      return errorResponse('Could not start verification.', 500);
    }

    return successResponse({ verification_url: session.verificationUrl });
  } catch (err) {
    // The adapter throws with the observed response keys when the vendor's
    // shape is not what we mapped. Log it; never show a vendor error to a user.
    console.error('kyc-create-session failed', String(err));
    return errorResponse('Could not start verification. Try again.', 502);
  }
});
