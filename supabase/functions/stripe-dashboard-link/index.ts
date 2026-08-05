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

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  // Rate limit: 50 login link requests per day
  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'stripe-dashboard-link',
    maxCount: 50,
    windowType: 'daily',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) {
    return successResponse({ url: 'https://dashboard.stripe.com/test/dashboard' });
  }

  const supabase = getSupabaseClient();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

  const { data: account } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete')
    .eq('user_id', auth.userId)
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
