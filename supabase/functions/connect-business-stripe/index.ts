// supabase/functions/connect-business-stripe/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { business_id: string; action?: 'onboard' | 'dashboard_link' };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { business_id, action = 'onboard' } = body;
  if (!business_id) return errorResponse('Missing business_id', 400);

  if (DEV_MOCK) {
    if (action === 'dashboard_link') {
      return successResponse({ url: 'https://connect.stripe.com/express/mock/dashboard' });
    }
    return successResponse({ url: 'https://connect.stripe.com/setup/e/mock' });
  }

  const supabase = getSupabaseClient();
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20' as any });
  const STUDIO_URL = Deno.env.get('STUDIO_URL') ?? 'https://roxy-studio.vercel.app';

  // Verify business ownership
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id, stripe_account_id, payout_schedule_set')
    .eq('id', business_id)
    .eq('owner_id', userId)
    .maybeSingle();

  if (bizErr || !business) return errorResponse('Business not found or access denied', 404);

  if (action === 'dashboard_link') {
    if (!business.stripe_account_id) return errorResponse('No Stripe account found', 400);
    const link = await stripe.accounts.createLoginLink(business.stripe_account_id);
    return successResponse({ url: link.url });
  }

  // Create or retrieve Stripe Express account
  let stripeAccountId = business.stripe_account_id;

  if (!stripeAccountId) {
    const account = await stripe.accounts.create({ type: 'express' });
    stripeAccountId = account.id;
    await supabase
      .from('businesses')
      .update({ stripe_account_id: stripeAccountId })
      .eq('id', business_id);
  }

  // Configure payout schedule if not yet set
  if (!business.payout_schedule_set) {
    try {
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
    } catch {
      // Non-fatal — account may not yet support schedule configuration
    }
  }

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${STUDIO_URL}/stripe-onboarding?business_id=${business_id}&stripe=refresh`,
    return_url: `${STUDIO_URL}/stripe-onboarding?business_id=${business_id}&stripe=success`,
    type: 'account_onboarding',
  });

  return successResponse({ url: accountLink.url });
});
