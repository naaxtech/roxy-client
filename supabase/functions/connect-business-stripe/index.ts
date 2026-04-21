// supabase/functions/connect-business-stripe/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@17';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  console.log('[connect-business-stripe] stage: auth');
  const auth = verifyJWT(req);
  if (!auth) {
    console.error('[connect-business-stripe] auth failed — no valid JWT');
    return errorResponse('Unauthorized', 401);
  }
  const { userId } = auth;
  console.log('[connect-business-stripe] auth ok, userId:', userId.slice(0, 8) + '...');

  let body: { business_id: string; action?: 'onboard' | 'dashboard_link' };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { business_id, action = 'onboard' } = body;
  if (!business_id) return errorResponse('Missing business_id', 400);
  console.log('[connect-business-stripe] action:', action, 'business_id:', business_id);

  if (DEV_MOCK) {
    if (action === 'dashboard_link') {
      return successResponse({ url: 'https://connect.stripe.com/express/mock/dashboard' });
    }
    return successResponse({ url: 'https://connect.stripe.com/setup/e/mock' });
  }

  const supabase = getSupabaseClient();
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  console.log('[connect-business-stripe] stripe key prefix:', stripeKey.slice(0, 7));

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
  const STUDIO_URL = Deno.env.get('STUDIO_URL') ?? 'https://roxycommunity.netlify.app';
  console.log('[connect-business-stripe] STUDIO_URL:', STUDIO_URL);

  // Verify business ownership
  console.log('[connect-business-stripe] stage: fetch business');
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id, stripe_account_id, payout_schedule_set')
    .eq('id', business_id)
    .eq('owner_id', userId)
    .maybeSingle();

  if (bizErr) {
    console.error('[connect-business-stripe] db error:', bizErr.message);
    return errorResponse(`DB error: ${bizErr.message}`, 500);
  }
  if (!business) {
    console.error('[connect-business-stripe] business not found for owner', userId.slice(0, 8));
    return errorResponse('Business not found or access denied', 404);
  }
  console.log('[connect-business-stripe] business found, stripe_account_id:', business.stripe_account_id ?? 'none');

  try {
    if (action === 'dashboard_link') {
      if (!business.stripe_account_id) return errorResponse('No Stripe account found', 400);
      console.log('[connect-business-stripe] stage: create login link');
      const link = await stripe.accounts.createLoginLink(business.stripe_account_id);
      return successResponse({ url: link.url });
    }

    // Create or retrieve Stripe Express account
    let stripeAccountId = business.stripe_account_id;

    if (!stripeAccountId) {
      console.log('[connect-business-stripe] stage: create express account');
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;
      console.log('[connect-business-stripe] created account:', stripeAccountId);
      await supabase
        .from('businesses')
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', business_id);
    } else {
      console.log('[connect-business-stripe] reusing account:', stripeAccountId);
    }

    // Configure payout schedule if not yet set
    if (!business.payout_schedule_set) {
      try {
        console.log('[connect-business-stripe] stage: configure payout schedule');
        await stripe.accounts.update(stripeAccountId, {
          settings: {
            payouts: {
              schedule: { interval: 'weekly', weekly_anchor: 'monday', delay_days: 7 },
              debit_negative_balances: true,
            },
          },
        } as any);
        await supabase
          .from('businesses')
          .update({ payout_schedule_set: true })
          .eq('id', business_id);
      } catch (schedErr) {
        // Non-fatal — Express accounts may not support schedule configuration until verified
        console.warn('[connect-business-stripe] payout schedule skipped:', (schedErr as Error).message);
      }
    }

    console.log('[connect-business-stripe] stage: create account link');
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${STUDIO_URL}/settings?product_stripe=refresh`,
      return_url: `${STUDIO_URL}/settings?product_stripe=success`,
      type: 'account_onboarding',
    });
    console.log('[connect-business-stripe] success, url length:', accountLink.url?.length);
    return successResponse({ url: accountLink.url });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stripeCode = (err as any)?.code ?? null;
    const stripeType = (err as any)?.type ?? null;
    console.error('[connect-business-stripe] stripe error:', { message, stripeCode, stripeType });
    return errorResponse(`Stripe error [${stripeType ?? 'unknown'}/${stripeCode ?? 'none'}]: ${message}`, 500);
  }
});
