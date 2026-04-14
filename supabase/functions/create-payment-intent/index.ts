// supabase/functions/create-payment-intent/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const { user, errorResponse: authErr } = await verifyJWT(req);
  if (authErr) return authErr;

  await checkRateLimit(user.id, 'create-payment-intent', 'daily', 10);

  const body = await req.json().catch(() => ({}));
  const { event_id } = body;

  if (!event_id || !UUID_RE.test(event_id)) {
    return errorResponse('Invalid event_id', 400);
  }

  if (DEV_MOCK) {
    return successResponse({
      client_secret: 'pi_mock_secret_test',
      publishable_key: 'pk_test_mock',
    });
  }

  const supabase = getSupabaseClient();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY')!;

  // Load event
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('id, title, is_paid, price_cents, currency, max_attendees, community_id, host_id, is_private, status')
    .eq('id', event_id)
    .maybeSingle();

  if (eventErr || !event) return errorResponse('Event not found', 404);
  if ((event as any).status && (event as any).status !== 'active') {
    return errorResponse('This event is no longer active', 400);
  }
  if (!event.is_paid || !event.price_cents) return errorResponse('Event is not a paid event', 400);
  if (event.price_cents < 50) return errorResponse('Price below Stripe minimum ($0.50)', 400);

  // Private event membership check (A01)
  if (event.is_private) {
    const { data: membership } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', event.community_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) return errorResponse('You must be a community member to purchase this ticket', 403);
  }

  // Load host Stripe account
  const { data: hostAccount } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, fee_tier')
    .eq('user_id', event.host_id)
    .maybeSingle();

  if (!hostAccount?.stripe_account_id) return errorResponse('Host has not connected Stripe', 400);

  // Load fee percent
  const { data: feeTier } = await supabase
    .from('fee_tiers')
    .select('fee_percent')
    .eq('tier_name', hostAccount.fee_tier)
    .maybeSingle();

  const feePercent = Number(feeTier?.fee_percent ?? 15);
  const feeCents = Math.round(event.price_cents * feePercent / 100);
  const hostPayoutCents = event.price_cents - feeCents;

  // Platform-holds model: charge lands on Roxy's platform account.
  // Transfer to host is created separately by release-payout after event completes + delay.
  // No on_behalf_of / transfer_data — fees tracked in payment_logs only.
  const pi = await stripe.paymentIntents.create(
    {
      amount: event.price_cents,
      currency: event.currency ?? 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { event_id, host_id: event.host_id, user_id: user.id },
    },
    { idempotencyKey: `${event_id}:${user.id}` },
  );

  // Insert pending payment_logs row — buyer_id from JWT (never from Stripe metadata)
  await supabase.from('payment_logs').upsert(
    {
      payment_intent_id: pi.id,
      event_id,
      buyer_id: user.id,
      host_id: event.host_id,
      amount_cents: event.price_cents,
      fee_cents: feeCents,
      host_payout_cents: hostPayoutCents,
      currency: event.currency ?? 'usd',
      status: 'pending',
    },
    { onConflict: 'payment_intent_id', ignoreDuplicates: true },
  );

  return successResponse({ client_secret: pi.client_secret, publishable_key: publishableKey });
});
