// supabase/functions/create-donation-checkout/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@17';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

const SUCCESS_URL = 'https://roxy.expo.app/grow?donation=thanks';
const CANCEL_URL = 'https://roxy.expo.app/grow';

type Cadence = 'one_time' | 'monthly' | 'yearly';
const VALID_CADENCES: Cadence[] = ['one_time', 'monthly', 'yearly'];

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  console.log('[create-donation-checkout] stage: auth');
  const auth = verifyJWT(req);
  if (!auth) {
    console.error('[create-donation-checkout] auth failed — no valid JWT');
    return errorResponse('Unauthorized', 401);
  }
  const { userId } = auth;
  console.log('[create-donation-checkout] auth ok, userId:', userId.slice(0, 8) + '...');

  let body: { amount_cents: number; cadence: Cadence };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { amount_cents, cadence } = body;

  if (
    typeof amount_cents !== 'number' ||
    !Number.isInteger(amount_cents) ||
    amount_cents < 500 ||
    amount_cents > 100000
  ) {
    return errorResponse('amount_cents must be an integer between 500 and 100000', 400);
  }
  if (!VALID_CADENCES.includes(cadence)) {
    return errorResponse('cadence must be one_time, monthly, or yearly', 400);
  }
  console.log('[create-donation-checkout] amount_cents:', amount_cents, 'cadence:', cadence);

  if (DEV_MOCK) {
    return successResponse({ url: 'https://example.com/mock-checkout' });
  }

  const supabase = getSupabaseClient();
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  console.log('[create-donation-checkout] stripe key prefix:', stripeKey.slice(0, 7));

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

  try {
    console.log('[create-donation-checkout] stage: create checkout session');

    const session = await (cadence === 'one_time'
      ? stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: amount_cents,
                product_data: { name: 'Donation to Roxy 💜' },
              },
              quantity: 1,
            },
          ],
          success_url: SUCCESS_URL,
          cancel_url: CANCEL_URL,
          client_reference_id: userId,
          metadata: { user_id: userId, cadence },
        })
      : stripe.checkout.sessions.create({
          mode: 'subscription',
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: amount_cents,
                recurring: { interval: cadence === 'monthly' ? 'month' : 'year' },
                product_data: {
                  name: cadence === 'monthly' ? 'Monthly donation to Roxy 💜' : 'Yearly donation to Roxy 💜',
                },
              },
              quantity: 1,
            },
          ],
          success_url: SUCCESS_URL,
          cancel_url: CANCEL_URL,
          client_reference_id: userId,
          metadata: { user_id: userId, cadence },
        }));

    console.log('[create-donation-checkout] session created:', session.id);

    const { error: insertErr } = await supabase.from('donations').insert({
      user_id: userId,
      amount_cents,
      cadence,
      status: 'pending',
      stripe_checkout_session_id: session.id,
    });

    if (insertErr) {
      console.error('[create-donation-checkout] db insert error:', insertErr.message);
      return errorResponse(`DB error: ${insertErr.message}`, 500);
    }

    console.log('[create-donation-checkout] success, url length:', session.url?.length);
    return successResponse({ url: session.url });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stripeCode = (err as any)?.code ?? null;
    const stripeType = (err as any)?.type ?? null;
    console.error('[create-donation-checkout] stripe error:', { message, stripeCode, stripeType });
    return errorResponse(`Stripe error [${stripeType ?? 'unknown'}/${stripeCode ?? 'none'}]: ${message}`, 500);
  }
});
