// supabase/functions/stripe-connect-onboard/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const result = await verifyJWT(req);
  if (!result) return errorResponse('Unauthorized', 401);
  const { userId } = result;

  if (DEV_MOCK) {
    return successResponse({ onboarding_url: 'https://connect.stripe.com/setup/e/mock' });
  }

  const supabase = getSupabaseClient();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

  const STUDIO_URL = Deno.env.get('STUDIO_URL') ?? 'https://studio.roxy.app';

  try {
    // Check for existing Stripe account
    const { data: existing } = await supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();

    let stripeAccountId: string;

    if (existing?.stripe_account_id) {
      stripeAccountId = existing.stripe_account_id;
    } else {
      // Create new Stripe Express account
      const account = await stripe.accounts.create({ type: 'express' });
      stripeAccountId = account.id;

      await supabase.from('host_stripe_accounts').insert({
        user_id: userId,
        stripe_account_id: stripeAccountId,
        onboarding_complete: false,
      });
    }

    // Create account link for onboarding/resuming
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${STUDIO_URL}/settings?stripe=refresh`,
      return_url: `${STUDIO_URL}/settings?stripe=success`,
      type: 'account_onboarding',
    });

    return successResponse({ onboarding_url: accountLink.url });
  } catch (err) {
    console.error('stripe-connect-onboard error:', err);
    return errorResponse('Failed to create Stripe onboarding link', 500);
  }
});
