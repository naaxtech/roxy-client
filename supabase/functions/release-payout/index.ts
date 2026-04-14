// supabase/functions/release-payout/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { successResponse, errorResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return errorResponse('Forbidden', 403);
  }

  const body = await req.json().catch(() => ({}));
  const specificEventId: string | undefined = body.event_id;

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const supabase = getSupabaseClient();

  // Load platform default delay
  const { data: platformSettings } = await supabase
    .from('platform_settings')
    .select('default_payout_delay_days')
    .eq('id', 1)
    .maybeSingle();
  const defaultDelayDays = (platformSettings as any)?.default_payout_delay_days ?? 0;

  // Find eligible completed events
  let query = supabase
    .from('events')
    .select('id, title, host_id, payout_delay_days, payout_blocked, payout_released_at, currency')
    .eq('status', 'completed')
    .eq('payout_blocked', false)
    .is('payout_released_at', null);

  if (specificEventId) {
    query = query.eq('id', specificEventId);
  }

  const { data: events } = await query;

  if (!events || events.length === 0) {
    return successResponse({ released: 0, skipped: 0, failed: 0 });
  }

  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events) {
    // Check payout window: ends_at + delay <= now
    const delayDays = (event as any).payout_delay_days ?? defaultDelayDays;
    const { data: eventFull } = await supabase
      .from('events')
      .select('ends_at')
      .eq('id', event.id)
      .maybeSingle();

    if (!(eventFull as any)?.ends_at) { skipped++; continue; }

    const releaseAfter = new Date((eventFull as any).ends_at);
    releaseAfter.setDate(releaseAfter.getDate() + delayDays);
    if (releaseAfter > new Date()) { skipped++; continue; }

    // Re-verify payout_blocked after potential race
    const { data: freshEvent } = await supabase
      .from('events')
      .select('payout_blocked, payout_released_at')
      .eq('id', event.id)
      .maybeSingle();

    if ((freshEvent as any)?.payout_blocked || (freshEvent as any)?.payout_released_at) {
      skipped++;
      continue;
    }

    // Load host Stripe account
    const { data: hostAccount } = await supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', event.host_id)
      .maybeSingle();

    if (!(hostAccount as any)?.stripe_account_id || !(hostAccount as any)?.onboarding_complete) {
      skipped++;
      continue;
    }

    // Check payouts still enabled on Stripe side
    try {
      const stripeAccount = await stripe.accounts.retrieve((hostAccount as any).stripe_account_id);
      if (!stripeAccount.payouts_enabled) { skipped++; continue; }
    } catch { skipped++; continue; }

    // Sum host payout from succeeded payment_logs
    const { data: logs } = await supabase
      .from('payment_logs')
      .select('host_payout_cents')
      .eq('event_id', event.id)
      .eq('status', 'succeeded');

    const totalPayout = (logs ?? []).reduce((sum: number, r: any) => sum + (r.host_payout_cents ?? 0), 0);
    if (totalPayout === 0) { skipped++; continue; }

    try {
      await stripe.transfers.create(
        {
          amount: totalPayout,
          currency: (event as any).currency ?? 'usd',
          destination: (hostAccount as any).stripe_account_id,
          metadata: { event_id: event.id },
        },
        { idempotencyKey: `payout:${event.id}` },
      );

      const now = new Date().toISOString();
      await supabase
        .from('events')
        .update({ payout_released_at: now })
        .eq('id', event.id);

      await supabase
        .from('payment_logs')
        .update({ status: 'paid_out', updated_at: now })
        .eq('event_id', event.id)
        .eq('status', 'succeeded');

      await supabase.from('audit_log').insert({
        action: 'release_payout',
        target_type: 'event',
        target_id: event.id,
        metadata: {
          amount_cents: totalPayout,
          stripe_account: (hostAccount as any).stripe_account_id,
        },
      });

      released++;
    } catch (err: any) {
      const code = err?.raw?.code ?? err?.message ?? 'unknown';
      // Block payout for staff review on Stripe-level errors
      if (code === 'insufficient_funds' || code === 'platform_payout_not_allowed') {
        await supabase
          .from('events')
          .update({ payout_blocked: true })
          .eq('id', event.id);
        await supabase.from('audit_log').insert({
          action: 'block_payout',
          target_type: 'event',
          target_id: event.id,
          metadata: { reason: 'stripe_error', error_code: code },
        });
      }
      console.error(`Transfer failed for event ${event.id}:`, code);
      failed++;
    }
  }

  return successResponse({ released, skipped, failed });
});
