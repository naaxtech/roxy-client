// supabase/functions/stripe-connect-onboard/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const result = verifyJWT(req);
  if (!result) return errorResponse('Unauthorized', 401);
  const { userId } = result;

  if (DEV_MOCK) {
    return successResponse({ onboarding_url: 'https://connect.stripe.com/setup/e/mock' });
  }

  try {
    console.log('[onboard] stage: init');
    const supabase = getSupabaseClient();

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
    console.log('[onboard] stage: stripe key present, prefix:', stripeKey.slice(0, 7));

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
    const STUDIO_URL = Deno.env.get('STUDIO_URL') ?? 'https://roxy-studio.vercel.app';
    console.log('[onboard] stage: STUDIO_URL =', STUDIO_URL);

    // Check for existing Stripe account
    console.log('[onboard] stage: checking existing account');
    const { data: existing, error: dbError } = await supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (dbError) return errorResponse(`DB error: ${dbError.message}`, 500);

    let stripeAccountId: string;

    if (existing?.stripe_account_id) {
      stripeAccountId = existing.stripe_account_id;
      console.log('[onboard] stage: reusing account', stripeAccountId);
    } else {
      console.log('[onboard] stage: creating express account');
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;
      console.log('[onboard] stage: created account', stripeAccountId);

      await supabase.from('host_stripe_accounts').insert({
        user_id: userId,
        stripe_account_id: stripeAccountId,
        onboarding_complete: false,
      });
    }

    console.log('[onboard] stage: creating account link');
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${STUDIO_URL}/settings?stripe=refresh`,
      return_url: `${STUDIO_URL}/settings?stripe=success`,
      type: 'account_onboarding',
    });

    console.log('[onboard] stage: success, url length:', accountLink.url?.length);
    return successResponse({ onboarding_url: accountLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stripeCode = (err as any)?.code ?? null;
    const stripeType = (err as any)?.type ?? null;
    console.error('[onboard] error:', { message, stripeCode, stripeType });
    return errorResponse(`Stripe error [${stripeType ?? 'unknown'}/${stripeCode ?? 'none'}]: ${message}`, 500);
  }
});
