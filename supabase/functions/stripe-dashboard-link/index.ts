// supabase/functions/stripe-dashboard-link/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const { user, errorResponse: authErr } = verifyJWT(req);
  if (authErr) return authErr;

  // Rate limit: 50 login link requests per day
  await checkRateLimit(user.id, 'stripe-dashboard-link', 'daily', 50);

  if (DEV_MOCK) {
    return successResponse({ url: 'https://dashboard.stripe.com/test/dashboard' });
  }

  const supabase = getSupabaseClient();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

  const { data: account } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account?.stripe_account_id) {
    return errorResponse('No Stripe account connected', 400);
  }

  if (!account.onboarding_complete) {
    return errorResponse('Stripe onboarding not complete', 400);
  }

  const loginLink = await stripe.accounts.createLoginLink(account.stripe_account_id);

  return successResponse({ url: loginLink.url });
});
