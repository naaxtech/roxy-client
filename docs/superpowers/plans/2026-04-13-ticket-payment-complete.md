# Ticket Payment — Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ticket payments fully usable across Roxy client (mobile) and Roxy Studio (web) — platform-holds Stripe model, payout lifecycle, staff dashboard, My Tickets screen.

**Architecture:** Payments land on Roxy's platform Stripe account. Transfers to hosts created after `ends_at + payout_delay_days`. Cancellations trigger bulk refunds via a cron-driven queue. Staff controls live in Studio behind an `is_staff` flag verified server-side.

**Tech Stack:** Supabase Edge Functions (Deno), Stripe Node SDK v14, Next.js App Router (Studio), Expo Router v3 + `@stripe/stripe-react-native` (mobile), shadcn/ui, FlashList, react-native-qrcode-svg, pg_cron, Supabase Realtime.

---

## Phase 1 — Database

### Task 1: Migration 023

**Files:**
- Create: `supabase/migrations/023_tickets_phase3.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/023_tickets_phase3.sql

-- 1. profiles: is_staff flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

-- 2. events: lifecycle columns
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed')),
  ADD COLUMN IF NOT EXISTS payout_delay_days integer,
  ADD COLUMN IF NOT EXISTS payout_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id);

-- Paid events must have ends_at
ALTER TABLE public.events
  ADD CONSTRAINT events_paid_requires_ends_at
    CHECK (NOT is_paid OR ends_at IS NOT NULL);

-- 3. event_attendees: check-in columns
ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS is_checked_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

-- 4. payment_logs: refund tracking columns + status extension
ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS needs_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_error text,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text UNIQUE;

-- Extend status check to include new values
ALTER TABLE public.payment_logs
  DROP CONSTRAINT IF EXISTS payment_logs_status_check;
ALTER TABLE public.payment_logs
  ADD CONSTRAINT payment_logs_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'paid_out'));

-- 5. audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES public.profiles(id),
  action text NOT NULL
    CHECK (action IN ('release_payout','block_payout','unblock_payout','cancel_event','retry_refund','mark_resolved')),
  target_type text NOT NULL CHECK (target_type IN ('event','payment_log')),
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Only service role can INSERT; staff can SELECT own rows
CREATE POLICY "audit_log_staff_read" ON public.audit_log
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

-- 6. RLS: hosts read all attendees for their events
CREATE POLICY "host_read_attendees" ON public.event_attendees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_attendees.event_id
        AND events.host_id = auth.uid()
    )
  );

-- 7. RLS: hosts update is_checked_in on their own event attendees
CREATE POLICY "host_checkin_attendees" ON public.event_attendees
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_attendees.event_id
        AND events.host_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- 8. RLS: hosts can cancel their own events (status → 'cancelled' only, via edge fn)
-- No direct UPDATE RLS — cancellation goes through cancel-event edge function
-- which uses service-role client. Host ownership is verified in the function itself.

-- 9. pg_cron: auto-complete paid events 15 min after ends_at
-- Requires pg_cron extension (enabled on Supabase managed instances)
SELECT cron.schedule(
  'complete-paid-events',
  '*/15 * * * *',
  $$
    UPDATE public.events
    SET status = 'completed'
    WHERE status = 'active'
      AND is_paid = true
      AND ends_at IS NOT NULL
      AND ends_at < now()
  $$
);
```

- [ ] **Step 2: Push migration locally**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: migration applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/023_tickets_phase3.sql
git commit -m "feat(db): migration 023 — audit_log, is_staff, event lifecycle, check-in, refund tracking"
```

---

## Phase 2 — Edge Functions

### Task 2: Modify `create-payment-intent` — platform-holds model

**Files:**
- Modify: `supabase/functions/create-payment-intent/index.ts`

- [ ] **Step 1: Remove `on_behalf_of` and `transfer_data`, add `status` check**

Replace the PaymentIntent creation block (lines 81–92) with:

```ts
  // Reject if event is not active
  if ((event as any).status && (event as any).status !== 'active') {
    return errorResponse('This event is no longer active', 400);
  }

  // Platform-holds model: charge lands on Roxy's platform account.
  // Transfer to host is created separately after event completes.
  const pi = await stripe.paymentIntents.create(
    {
      amount: event.price_cents,
      currency: event.currency ?? 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { event_id, host_id: event.host_id, user_id: user.id },
    },
    { idempotencyKey: `${event_id}:${user.id}` },
  );
```

Also update the `events` select to include `status`:

```ts
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('id, title, is_paid, price_cents, currency, max_attendees, community_id, host_id, is_private, status')
    .eq('id', event_id)
    .maybeSingle();
```

Remove `application_fee_amount` from the PaymentIntent — fees are tracked in `payment_logs` only.

- [ ] **Step 2: Test locally with DEV_MOCK**

```bash
npx supabase functions serve create-payment-intent
curl -X POST http://localhost:54321/functions/v1/create-payment-intent \
  -H "Authorization: Bearer anon_key" \
  -H "Content-Type: application/json" \
  -d '{"event_id":"00000000-0000-0000-0000-000000000001"}'
```

Expected in DEV_MOCK: `{ client_secret: 'pi_mock_secret_test', publishable_key: 'pk_test_mock' }`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-payment-intent/index.ts
git commit -m "feat(edge): create-payment-intent — platform-holds model, remove on_behalf_of/transfer_data"
```

---

### Task 3: Extend `stripe-webhooks`

**Files:**
- Modify: `supabase/functions/stripe-webhooks/index.ts`

- [ ] **Step 1: Add `payment_intent.payment_failed` and `charge.dispute.created` handlers**

Add two new cases inside the `switch (event.type)` block after `payment_intent.succeeded`:

```ts
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await supabase
          .from('payment_logs')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('payment_intent_id', pi.id)
          .eq('status', 'pending');
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        if (!chargeId) break;

        // Find the PaymentIntent for this charge
        const charge = await stripe.charges.retrieve(chargeId);
        const piId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (!piId) break;

        // Find the event from payment_logs
        const { data: log } = await supabase
          .from('payment_logs')
          .select('event_id')
          .eq('payment_intent_id', piId)
          .maybeSingle();
        if (!log?.event_id) break;

        // Block the payout and log for staff
        await supabase
          .from('events')
          .update({ payout_blocked: true })
          .eq('id', log.event_id);

        await supabase.from('audit_log').insert({
          action: 'block_payout',
          target_type: 'event',
          target_id: log.event_id,
          metadata: { reason: 'dispute', dispute_id: dispute.id, payment_intent_id: piId },
        });
        break;
      }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/stripe-webhooks/index.ts
git commit -m "feat(edge): stripe-webhooks — add payment_failed and dispute.created handlers"
```

---

### Task 4: New `cancel-event` edge function

**Files:**
- Create: `supabase/functions/cancel-event/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/cancel-event/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const { user, errorResponse: authErr } = await verifyJWT(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({}));
  const { event_id } = body;

  if (!event_id || !UUID_RE.test(event_id)) {
    return errorResponse('Invalid event_id', 400);
  }

  await checkRateLimit(user.id, 'cancel-event', 'daily', 5);

  const supabase = getSupabaseClient();

  // Verify caller is host OR staff
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .maybeSingle();

  const { data: event } = await supabase
    .from('events')
    .select('id, title, host_id, status, community_id')
    .eq('id', event_id)
    .maybeSingle();

  if (!event) return errorResponse('Event not found', 404);
  if (event.status !== 'active') return errorResponse('Event is not active', 400);
  if (event.host_id !== user.id && !profile?.is_staff) {
    return errorResponse('Forbidden', 403);
  }

  if (DEV_MOCK) {
    return successResponse({ cancelled: true, refunds_queued: 0 });
  }

  // Cancel event and flag payment_logs for refund
  const now = new Date().toISOString();

  await supabase
    .from('events')
    .update({
      status: 'cancelled',
      payout_blocked: true,
      cancelled_at: now,
      cancelled_by: user.id,
    })
    .eq('id', event_id);

  const { data: logsToRefund } = await supabase
    .from('payment_logs')
    .update({ needs_refund: true })
    .eq('event_id', event_id)
    .eq('status', 'succeeded')
    .select('buyer_id');

  const refundsQueued = logsToRefund?.length ?? 0;

  // Write audit log if staff action
  if (profile?.is_staff) {
    await supabase.from('audit_log').insert({
      staff_id: user.id,
      action: 'cancel_event',
      target_type: 'event',
      target_id: event_id,
      metadata: { refunds_queued: refundsQueued, event_title: event.title },
    });
  }

  // OneSignal push — deduplicated by buyer_id
  const oneSignalKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
  const oneSignalAppId = Deno.env.get('ONESIGNAL_APP_ID');

  if (oneSignalKey && oneSignalAppId && refundsQueued > 0) {
    const uniqueBuyerIds = [...new Set((logsToRefund ?? []).map((r: any) => r.buyer_id))];

    // Fetch push tokens for buyers
    const { data: buyerProfiles } = await supabase
      .from('profiles')
      .select('push_token')
      .in('id', uniqueBuyerIds)
      .not('push_token', 'is', null);

    const tokens = (buyerProfiles ?? []).map((p: any) => p.push_token).filter(Boolean);

    if (tokens.length > 0) {
      await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${oneSignalKey}`,
        },
        body: JSON.stringify({
          app_id: oneSignalAppId,
          include_player_ids: tokens,
          headings: { en: 'Event Cancelled' },
          contents: {
            en: `${event.title} has been cancelled. Your refund will appear in 5–10 business days.`,
          },
          data: { type: 'event_cancelled', event_id },
        }),
      }).catch((e) => console.error('OneSignal push failed:', e));
    }
  }

  return successResponse({ cancelled: true, refunds_queued: refundsQueued });
});
```

- [ ] **Step 2: Add to config.toml**

Add under the existing `[functions.*]` blocks:

```toml
[functions.cancel-event]
verify_jwt = false
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/cancel-event/index.ts supabase/config.toml
git commit -m "feat(edge): cancel-event — cancels event, flags needs_refund, sends OneSignal push"
```

---

### Task 5: New `process-refunds` edge function

**Files:**
- Create: `supabase/functions/process-refunds/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/process-refunds/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { successResponse, errorResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  // Service-role only — reject everything else
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return errorResponse('Forbidden', 403);
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const supabase = getSupabaseClient();

  // Fetch up to 50 rows needing refund that haven't been processed yet
  const { data: rows } = await supabase
    .from('payment_logs')
    .select('id, payment_intent_id, stripe_refund_id')
    .eq('needs_refund', true)
    .is('stripe_refund_id', null)
    .limit(50);

  if (!rows || rows.length === 0) {
    return successResponse({ processed: 0, failed: 0, skipped: 0 });
  }

  let processed = 0;
  let failed = 0;

  // Process in batches of 10
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    await Promise.all(
      batch.map(async (row: any) => {
        // Double-check idempotency — skip if already has refund id
        if (row.stripe_refund_id) { return; }

        try {
          const refund = await stripe.refunds.create(
            { payment_intent: row.payment_intent_id },
            { idempotencyKey: `refund:${row.payment_intent_id}` },
          );
          await supabase
            .from('payment_logs')
            .update({
              stripe_refund_id: refund.id,
              status: 'refunded',
              needs_refund: false,
              refund_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          processed++;
        } catch (err: any) {
          const errorCode = err?.raw?.code ?? err?.message ?? 'unknown';
          await supabase
            .from('payment_logs')
            .update({ refund_error: errorCode, updated_at: new Date().toISOString() })
            .eq('id', row.id);
          console.error(`Refund failed for payment_log ${row.id}:`, errorCode);
          failed++;
        }
      }),
    );
  }

  return successResponse({ processed, failed, skipped: rows.length - processed - failed });
});
```

- [ ] **Step 2: Add to config.toml** (scheduled every 15 min)

```toml
[functions.process-refunds]
verify_jwt = false
schedule = "*/15 * * * *"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/process-refunds/index.ts supabase/config.toml
git commit -m "feat(edge): process-refunds — cron-driven batch Stripe refunds with per-row retry"
```

---

### Task 6: New `release-payout` edge function

**Files:**
- Create: `supabase/functions/release-payout/index.ts`

- [ ] **Step 1: Write the function**

```ts
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
  const defaultDelayDays = platformSettings?.default_payout_delay_days ?? 0;

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
    const delayDays = event.payout_delay_days ?? defaultDelayDays;
    const { data: eventFull } = await supabase
      .from('events')
      .select('ends_at')
      .eq('id', event.id)
      .maybeSingle();

    if (!eventFull?.ends_at) { skipped++; continue; }

    const releaseAfter = new Date(eventFull.ends_at);
    releaseAfter.setDate(releaseAfter.getDate() + delayDays);
    if (releaseAfter > new Date()) { skipped++; continue; }

    // Re-verify payout_blocked after potential race (FOR UPDATE not available via REST — check again)
    const { data: freshEvent } = await supabase
      .from('events')
      .select('payout_blocked, payout_released_at')
      .eq('id', event.id)
      .maybeSingle();

    if (freshEvent?.payout_blocked || freshEvent?.payout_released_at) { skipped++; continue; }

    // Load host Stripe account
    const { data: hostAccount } = await supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', event.host_id)
      .maybeSingle();

    if (!hostAccount?.stripe_account_id || !hostAccount.onboarding_complete) {
      skipped++;
      continue;
    }

    // Check payouts still enabled on Stripe side
    try {
      const stripeAccount = await stripe.accounts.retrieve(hostAccount.stripe_account_id);
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
          currency: event.currency ?? 'usd',
          destination: hostAccount.stripe_account_id,
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
        metadata: { amount_cents: totalPayout, stripe_account: hostAccount.stripe_account_id },
      });

      released++;
    } catch (err: any) {
      const code = err?.raw?.code ?? err?.message ?? 'unknown';
      // Insufficient funds or account issue — block payout for staff review
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
```

- [ ] **Step 2: Add to config.toml** (scheduled daily 02:00 UTC)

```toml
[functions.release-payout]
verify_jwt = false
schedule = "0 2 * * *"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/release-payout/index.ts supabase/config.toml
git commit -m "feat(edge): release-payout — Stripe Transfers with idempotency, audit_log, daily cron"
```

---

### Task 7: New `auto-complete-events` edge function

**Files:**
- Create: `supabase/functions/auto-complete-events/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/auto-complete-events/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { successResponse, errorResponse } from '../_shared/errorHandler.ts';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return errorResponse('Forbidden', 403);
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('events')
    .update({ status: 'completed' })
    .eq('status', 'active')
    .eq('is_paid', true)
    .not('ends_at', 'is', null)
    .lt('ends_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('auto-complete-events error:', error);
    return errorResponse('Failed to auto-complete events', 500);
  }

  return successResponse({ completed: data?.length ?? 0 });
});
```

- [ ] **Step 2: Add to config.toml**

```toml
[functions.auto-complete-events]
verify_jwt = false
schedule = "*/15 * * * *"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/auto-complete-events/index.ts supabase/config.toml
git commit -m "feat(edge): auto-complete-events — scheduled every 15min, marks paid events completed after ends_at"
```

---

## Phase 3 — Mobile

### Task 8: Update `types/index.ts`

**Files:**
- Modify: `apps/mobile/types/index.ts`

- [ ] **Step 1: Add missing fields to `Event`, add `EventAttendee` type**

Replace the `Event` interface (lines 132–147):

```ts
export interface Event {
  id: string;
  community_id: string | null;
  host_id: string;
  title: string;
  description: string | null;
  event_type: 'online' | 'in_person' | 'hybrid';
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  location_url: string | null;
  max_attendees: number | null;
  attendee_count: number;
  cover_image_url: string | null;
  is_paid: boolean;
  is_private: boolean;
  price_cents: number | null;
  currency: string;
  status: 'active' | 'cancelled' | 'completed';
  payout_delay_days: number | null;
  created_at: string;
}

export interface EventAttendee {
  event_id: string;
  user_id: string;
  status: 'going' | 'interested' | 'maybe';
  ticket_code: string;
  rsvp_at: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
}
```

- [ ] **Step 2: Verify with tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/types/index.ts
git commit -m "feat(mobile/types): add is_paid, price_cents, currency, status to Event; add EventAttendee"
```

---

### Task 9: Update `lib/stripe.ts`

**Files:**
- Modify: `apps/mobile/lib/stripe.ts`

- [ ] **Step 1: Remove hard timeout, fix cleanup, add soldOut result**

Replace the entire file:

```ts
import { useStripe } from '@stripe/stripe-react-native';
import { callEdgeFunction, supabase } from './supabase';
import { logError } from './errorLogger';

export function sanitizePaymentError(err: unknown): unknown {
  if (typeof err === 'object' && err !== null && 'client_secret' in err) {
    return { ...(err as object), client_secret: '[redacted]' };
  }
  return err;
}

export interface PurchaseTicketResult {
  success: boolean;
  ticketCode?: string | null;
  cancelled?: boolean;
  soldOut?: boolean;
  error?: string;
}

export async function purchaseTicket(
  eventId: string,
  initPaymentSheet: ReturnType<typeof useStripe>['initPaymentSheet'],
  presentPaymentSheet: ReturnType<typeof useStripe>['presentPaymentSheet'],
  userId: string,
): Promise<PurchaseTicketResult> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(eventId)) {
    return { success: false, error: 'Invalid event ID' };
  }

  let clientSecret: string;
  let publishableKey: string;

  try {
    const { data, error } = await callEdgeFunction<{ client_secret: string; publishable_key: string }>(
      'create-payment-intent',
      { event_id: eventId },
    );
    if (error || !data) {
      // Check for sold_out error from edge function
      if (error === 'sold_out' || error?.includes('sold_out')) {
        return { success: false, soldOut: true };
      }
      throw new Error(error ?? 'No payment data returned');
    }
    clientSecret = data.client_secret;
    publishableKey = data.publishable_key;
  } catch (err) {
    logError(sanitizePaymentError(err), 'purchaseTicket:createPaymentIntent');
    return { success: false, error: 'Could not initialise payment. Please try again.' };
  }

  const { error: initError } = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Roxy',
    applePay: { merchantCountryCode: 'US' },
    googlePay: { merchantCountryCode: 'US', testEnv: __DEV__ },
  });

  if (initError) {
    logError(sanitizePaymentError(initError), 'purchaseTicket:initPaymentSheet');
    return { success: false, error: 'Payment setup failed. Please try again.' };
  }

  const { error: presentError } = await presentPaymentSheet();

  if (presentError) {
    if (presentError.code === 'Canceled') {
      return { success: false, cancelled: true };
    }
    logError(sanitizePaymentError(presentError), 'purchaseTicket:presentPaymentSheet');
    return { success: false, error: presentError.message };
  }

  // Payment confirmed — return immediately. Caller subscribes to Realtime for ticket delivery.
  return { success: true, ticketCode: null };
}

// Subscribes to event_attendees INSERT for this user/event.
// Returns an unsubscribe function — MUST be called on component unmount.
export function subscribeToTicket(
  eventId: string,
  userId: string,
  onTicket: (ticketCode: string) => void,
): () => void {
  const channel = supabase
    .channel(`ticket:${eventId}:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'event_attendees',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        if (payload.new?.user_id === userId && payload.new?.ticket_code) {
          onTicket(payload.new.ticket_code);
        }
      },
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
```

- [ ] **Step 2: Run existing tests**

```bash
cd apps/mobile && npx jest --testPathPattern=stripe --ci
```

Expected: all pass (sanitizePaymentError tests still valid).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/stripe.ts
git commit -m "feat(mobile/stripe): remove hard timeout, fix Realtime cleanup, add soldOut path, extract subscribeToTicket"
```

---

### Task 10: Update `TicketCard` component

**Files:**
- Modify: `apps/mobile/components/TicketCard.tsx`

- [ ] **Step 1: Replace with collapsed/full variants**

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { format } from 'date-fns';
import { COLORS } from '../lib/constants';

interface TicketCardProps {
  eventTitle: string;
  startsAt: string;
  locationText: string | null;
  communityName: string | null;
  ticketCode: string;
  variant?: 'full' | 'collapsed';
  status?: 'active' | 'cancelled' | 'checked_in';
  onExpand?: () => void;
}

export function TicketCard({
  eventTitle,
  startsAt,
  locationText,
  communityName,
  ticketCode,
  variant = 'full',
  status = 'active',
  onExpand,
}: TicketCardProps) {
  const isCancelled = status === 'cancelled';
  const isCheckedIn = status === 'checked_in';
  const dateStr = format(new Date(startsAt), 'EEE d MMM · h:mm a');

  if (variant === 'collapsed') {
    return (
      <TouchableOpacity
        style={[styles.collapsed, isCancelled && styles.collapsedCancelled]}
        onPress={onExpand}
        activeOpacity={0.7}
      >
        <View style={styles.collapsedLeft}>
          <Text style={[styles.collapsedTitle, isCancelled && styles.cancelledText]} numberOfLines={1}>
            {eventTitle}
          </Text>
          <Text style={styles.collapsedDate}>{dateStr}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          isCancelled ? styles.badgeCancelled : isCheckedIn ? styles.badgeCheckedIn : styles.badgeActive,
        ]}>
          <Text style={styles.statusBadgeText}>
            {isCancelled ? 'Refunded' : isCheckedIn ? 'Checked In' : 'Going'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, isCancelled && styles.cardCancelled]}>
      <Text style={[styles.going, isCancelled && styles.cancelledLabel]}>
        {isCancelled ? '❌ Event Cancelled' : isCheckedIn ? '✅ Checked In' : '🌸 You\'re going!'}
      </Text>
      <Text style={[styles.title, isCancelled && styles.strikethrough]}>{eventTitle}</Text>
      <Text style={styles.date}>{dateStr}</Text>
      {locationText ? <Text style={styles.meta}>📍 {locationText}</Text> : null}
      {communityName ? <Text style={styles.meta}>🏳️‍🌈 {communityName}</Text> : null}

      {!isCancelled && (
        <View style={[styles.qrWrap, isCheckedIn && styles.qrWrapCheckedIn]} testID="ticket-qr">
          <QRCode value={ticketCode} size={160} />
          {isCheckedIn && (
            <View style={styles.checkedInStamp}>
              <Text style={styles.checkedInStampText}>CHECKED IN</Text>
            </View>
          )}
        </View>
      )}

      <Text style={[styles.code, isCancelled && styles.cancelledText]}>{ticketCode}</Text>
      {isCancelled && (
        <Text style={styles.refundNote}>Your refund will appear in 5–10 business days.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  cardCancelled: { borderColor: COLORS.error + '40', opacity: 0.7 },
  going: { color: COLORS.roxy, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  cancelledLabel: { color: COLORS.error },
  title: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 16, textAlign: 'center' },
  strikethrough: { textDecorationLine: 'line-through', color: COLORS.textMuted },
  date: { color: COLORS.textSecondary, fontSize: 13 },
  meta: { color: COLORS.textSecondary, fontSize: 13 },
  qrWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
    position: 'relative',
  },
  qrWrapCheckedIn: { opacity: 0.7 },
  checkedInStamp: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(34,197,94,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#22c55e',
  },
  checkedInStampText: {
    color: '#22c55e',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 2,
    transform: [{ rotate: '-20deg' }],
  },
  code: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  cancelledText: { color: COLORS.textMuted },
  refundNote: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Collapsed variant
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  collapsedCancelled: { borderColor: COLORS.error + '30', opacity: 0.7 },
  collapsedLeft: { flex: 1, marginRight: 12 },
  collapsedTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  collapsedDate: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeActive: { backgroundColor: COLORS.primary + '20' },
  badgeCancelled: { backgroundColor: COLORS.error + '20' },
  badgeCheckedIn: { backgroundColor: '#22c55e20' },
  statusBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/components/TicketCard.tsx
git commit -m "feat(mobile): TicketCard — add collapsed/full variants, status-aware rendering, checked-in overlay"
```

---

### Task 11: Update `TicketConfirmation`

**Files:**
- Modify: `apps/mobile/components/TicketConfirmation.tsx`

- [ ] **Step 1: Decouple from Realtime wait, update pending copy**

Replace the entire file:

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../lib/constants';

interface Event {
  title: string;
  starts_at: string;
  communities?: { name: string } | null;
}

interface Props {
  event: Event;
  ticketCode?: string | null;
  onViewTickets: () => void;
}

export function TicketConfirmation({ event, ticketCode, onViewTickets }: Props) {
  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're in! 🎉</Text>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.meta}>{dateStr}</Text>
      {event.communities?.name && (
        <Text style={styles.meta}>{event.communities.name}</Text>
      )}

      {ticketCode ? (
        <>
          <View style={styles.qrContainer}>
            <QRCode value={ticketCode} size={180} backgroundColor={COLORS.surface} color={COLORS.textPrimary} />
          </View>
          <Text style={styles.ticketCode}>{ticketCode}</Text>
        </>
      ) : (
        <Text style={styles.pending}>
          Payment confirmed — your ticket is on its way.{'\n'}
          It will appear in My Tickets shortly.
        </Text>
      )}

      <TouchableOpacity style={styles.btn} onPress={onViewTickets}>
        <Text style={styles.btnText}>View My Tickets</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 24, backgroundColor: COLORS.surface, borderRadius: 16 },
  heading: { fontSize: 24, fontWeight: '800', color: COLORS.roxy, marginBottom: 8 },
  eventTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  meta: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  qrContainer: { marginTop: 20, padding: 16, backgroundColor: COLORS.surface, borderRadius: 12 },
  ticketCode: { fontFamily: 'monospace', fontSize: 13, color: COLORS.textMuted, marginTop: 8, letterSpacing: 1 },
  pending: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 20, lineHeight: 22 },
  btn: { marginTop: 24, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/components/TicketConfirmation.tsx
git commit -m "feat(mobile): TicketConfirmation — decouple from Realtime wait, update pending copy"
```

---

### Task 12: Update `event/[id].tsx`

**Files:**
- Modify: `apps/mobile/app/event/[id].tsx`

- [ ] **Step 1: Add event status fields, Realtime on event row, new states**

Replace the `EventDetail` type and add Realtime subscription. Key changes:

1. Add `status`, `max_attendees` to `EventDetail`:

```ts
type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  event_type: 'online' | 'in_person' | 'hybrid';
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  location_url: string | null;
  attendee_count: number;
  max_attendees: number | null;
  is_paid: boolean;
  is_private: boolean;
  price_cents: number | null;
  status: 'active' | 'cancelled' | 'completed';
  community_id: string | null;
  communities: { id: string; name: string } | null;
};
```

2. Add `ticketSubscriptionRef` and `eventChannelRef`:

```ts
  const ticketSubscriptionUnsubRef = useRef<(() => void) | null>(null);
  const eventChannelRef = useRef<any>(null);
```

3. Import `subscribeToTicket` from `../../lib/stripe`.

4. Replace `handleBuyTicket`:

```ts
  const handleBuyTicket = async () => {
    if (!event || !user) return;
    // Sold out check
    if (event.max_attendees !== null && event.attendee_count >= event.max_attendees) {
      setPurchaseError('This event is sold out.');
      return;
    }
    setPurchasing(true);
    setPurchaseError(null);

    // Subscribe to ticket delivery BEFORE presenting payment sheet
    ticketSubscriptionUnsubRef.current = subscribeToTicket(event.id, user.id, (code) => {
      animateTicketIn(code);
    });

    const result = await purchaseTicket(event.id, initPaymentSheet, presentPaymentSheet, user.id);
    setPurchasing(false);

    if (result.success) {
      // Show confirmation immediately — ticket arrives via Realtime
      setPurchaseResult({ ticketCode: null });
    } else if (result.soldOut) {
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
      setPurchaseError('Sorry, this event just sold out.');
    } else if (!result.cancelled) {
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
      setPurchaseError(result.error ?? 'Payment failed. Please try again.');
    } else {
      // Cancelled — clean up subscription
      ticketSubscriptionUnsubRef.current?.();
      ticketSubscriptionUnsubRef.current = null;
    }
  };
```

5. Add Realtime subscription on the event row in `useEffect`:

```ts
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event-status:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` },
        (payload) => {
          if (payload.new?.status) {
            setEvent((prev) => prev ? { ...prev, status: payload.new.status } : prev);
          }
        },
      )
      .subscribe();
    eventChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [id]);
```

6. Add cleanup `useEffect` for ticket subscription:

```ts
  useEffect(() => {
    return () => {
      ticketSubscriptionUnsubRef.current?.();
      if (eventChannelRef.current) supabase.removeChannel(eventChannelRef.current);
    };
  }, []);
```

7. Add cancelled/completed banners before the main action area. In the JSX, before the action buttons:

```tsx
        {event.status === 'cancelled' && (
          <View style={styles.cancelledBanner}>
            <Text style={styles.cancelledBannerText}>
              ❌ This event was cancelled.
            </Text>
            {ticketCode && (
              <Text style={styles.cancelledBannerSub}>
                Your refund will appear in 5–10 business days.
              </Text>
            )}
          </View>
        )}
```

8. Replace Buy Ticket button section to add sold-out state:

```tsx
        {event.status === 'active' && !going && event.is_paid && (
          <View>
            {event.max_attendees !== null && event.attendee_count >= event.max_attendees ? (
              <View style={styles.soldOutBtn}>
                <Text style={styles.soldOutText}>Sold Out</Text>
              </View>
            ) : purchaseResult ? (
              <TicketConfirmation
                event={event}
                ticketCode={purchaseResult.ticketCode}
                onViewTickets={() => router.push('/(tabs)/grow/tickets' as any)}
              />
            ) : (
              <TouchableOpacity
                style={[styles.rsvpBtn, purchasing && styles.rsvpBtnDisabled]}
                onPress={handleBuyTicket}
                disabled={purchasing}
              >
                {purchasing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.rsvpBtnText}>
                      {`Buy Ticket — $${((event.price_cents ?? 0) / 100).toFixed(2)}`}
                    </Text>
                }
              </TouchableOpacity>
            )}
            {purchaseError && <Text style={styles.errorText}>{purchaseError}</Text>}
          </View>
        )}
```

9. Add new styles:

```ts
  cancelledBanner: {
    backgroundColor: COLORS.error + '15',
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: COLORS.error + '40',
  },
  cancelledBannerText: { color: COLORS.error, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  cancelledBannerSub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 },
  soldOutBtn: {
    marginTop: 24, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.textMuted + '40',
  },
  soldOutText: { color: COLORS.textMuted, fontWeight: '700', fontSize: 16 },
```

- [ ] **Step 2: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/event/[id].tsx
git commit -m "feat(mobile): event detail — cancelled/completed/sold-out states, Realtime on event row, decoupled ticket delivery"
```

---

### Task 13: My Tickets screen

**Files:**
- Create: `apps/mobile/app/(tabs)/grow/tickets.tsx`

- [ ] **Step 1: Check that grow stack exists**

```bash
ls apps/mobile/app/(tabs)/grow/
```

If `_layout.tsx` does not exist in that directory, create a stack layout:

```tsx
// apps/mobile/app/(tabs)/grow/_layout.tsx
import { Stack } from 'expo-router';
export default function GrowLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 2: Write the My Tickets screen**

```tsx
// apps/mobile/app/(tabs)/grow/tickets.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';
import { TicketCard } from '../../../components/TicketCard';

interface TicketRow {
  event_id: string;
  ticket_code: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  rsvp_at: string;
  events: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    location_text: string | null;
    status: 'active' | 'cancelled' | 'completed';
    communities: { name: string } | null;
  };
}

const PAGE_SIZE = 20;

export default function MyTicketsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const fetchTickets = useCallback(async (reset = false) => {
    if (!user) return;
    const currentPage = reset ? 0 : page;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data } = await supabase
      .from('event_attendees')
      .select('event_id, ticket_code, is_checked_in, checked_in_at, rsvp_at, events(id, title, starts_at, ends_at, location_text, status, communities(name))')
      .eq('user_id', user.id)
      .not('ticket_code', 'is', null)
      .order('rsvp_at', { ascending: false })
      .range(from, to);

    const rows = (data ?? []) as TicketRow[];
    if (reset) {
      setTickets(rows);
      setPage(1);
    } else {
      setTickets((prev) => [...prev, ...rows]);
      setPage((p) => p + 1);
    }
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
    setRefreshing(false);
  }, [user, page]);

  useEffect(() => {
    fetchTickets(true);
  }, [user]);

  // Realtime: update is_checked_in when host checks attendee in
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my-attendees:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'event_attendees',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setTickets((prev) =>
            prev.map((t) =>
              t.event_id === payload.new?.event_id
                ? { ...t, is_checked_in: payload.new.is_checked_in, checked_in_at: payload.new.checked_in_at }
                : t,
            ),
          );
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets(true);
  };

  const now = new Date();
  const upcoming = tickets.filter((t) => t.events && new Date(t.events.starts_at) >= now);
  const past = tickets.filter((t) => t.events && new Date(t.events.starts_at) < now);

  type ListItem =
    | { type: 'ticket'; data: TicketRow }
    | { type: 'divider' };

  const listData: ListItem[] = [
    ...upcoming.map((t): ListItem => ({ type: 'ticket', data: t })),
    ...(past.length > 0 ? [{ type: 'divider' } as ListItem] : []),
    ...past.map((t): ListItem => ({ type: 'ticket', data: t })),
  ];

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'divider') {
      return (
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>Past</Text>
          <View style={styles.dividerLine} />
        </View>
      );
    }
    const t = item.data;
    const isExpanded = expandedId === t.event_id;
    const eventStatus = t.events?.status ?? 'active';
    const ticketStatus = eventStatus === 'cancelled' ? 'cancelled'
      : t.is_checked_in ? 'checked_in'
      : 'active';

    return (
      <View style={styles.ticketWrap}>
        {isExpanded ? (
          <TouchableOpacity onPress={() => setExpandedId(null)} activeOpacity={1}>
            <TicketCard
              eventTitle={t.events?.title ?? ''}
              startsAt={t.events?.starts_at ?? ''}
              locationText={t.events?.location_text ?? null}
              communityName={t.events?.communities?.name ?? null}
              ticketCode={t.ticket_code}
              variant="full"
              status={ticketStatus}
            />
          </TouchableOpacity>
        ) : (
          <TicketCard
            eventTitle={t.events?.title ?? ''}
            startsAt={t.events?.starts_at ?? ''}
            locationText={t.events?.location_text ?? null}
            communityName={t.events?.communities?.name ?? null}
            ticketCode={t.ticket_code}
            variant="collapsed"
            status={ticketStatus}
            onExpand={() => setExpandedId(t.event_id)}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>My Tickets</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      ) : tickets.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tickets yet.</Text>
          <Text style={styles.emptySubText}>Find events in the Discover tab.</Text>
        </View>
      ) : (
        <FlashList
          data={listData}
          renderItem={renderItem}
          estimatedItemSize={80}
          keyExtractor={(item, i) => item.type === 'divider' ? 'divider' : item.data.event_id}
          contentContainerStyle={styles.list}
          onEndReached={() => { if (hasMore && !loading) fetchTickets(); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.roxy} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  back: { marginRight: 12 },
  heading: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  list: { padding: 16 },
  ticketWrap: { marginBottom: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.surface },
  dividerLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySubText: { color: COLORS.textSecondary, fontSize: 14 },
});
```

- [ ] **Step 3: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/(tabs)/grow/
git commit -m "feat(mobile): My Tickets screen — FlashList, pagination, Realtime check-in, collapsed/full toggle"
```

---

## Phase 4 — Studio

### Task 14: Studio API routes

**Files:**
- Create: `apps/studio/app/api/staff/release-payout/route.ts`
- Create: `apps/studio/app/api/staff/block-payout/route.ts`
- Create: `apps/studio/app/api/staff/cancel-event/route.ts`
- Create: `apps/studio/app/api/events/[id]/cancel/route.ts`
- Create: `apps/studio/app/api/events/[id]/checkin/route.ts`
- Create: `apps/studio/app/api/stripe/dashboard-link/route.ts`

- [ ] **Step 1: Staff auth helper**

Create `apps/studio/lib/staff-auth.ts`:

```ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function requireStaff(): Promise<
  { userId: string; accessToken: string } | NextResponse
> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.is_staff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token ?? '';
  return { userId, accessToken };
}
```

- [ ] **Step 2: `release-payout` route**

```ts
// apps/studio/app/api/staff/release-payout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const { event_id } = body;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/release-payout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ event_id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 3: `block-payout` route**

```ts
// apps/studio/app/api/staff/block-payout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff-auth';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  const { event_id, blocked } = await req.json().catch(() => ({}));
  if (!event_id || typeof blocked !== 'boolean') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const supabase = createServiceClient();
  await supabase.from('events').update({ payout_blocked: blocked }).eq('id', event_id);

  await supabase.from('audit_log').insert({
    staff_id: auth.userId,
    action: blocked ? 'block_payout' : 'unblock_payout',
    target_type: 'event',
    target_id: event_id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
```

Create `apps/studio/lib/supabase/service.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
```

- [ ] **Step 4: Staff `cancel-event` route**

```ts
// apps/studio/app/api/staff/cancel-event/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  const { event_id } = await req.json().catch(() => ({}));
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ event_id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 5: Host `cancel-event` route**

```ts
// apps/studio/app/api/events/[id]/cancel/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ event_id: params.id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 6: Check-in route**

```ts
// apps/studio/app/api/events/[id]/checkin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { user_id: attendeeUserId, is_checked_in } = await req.json().catch(() => ({}));
  if (!attendeeUserId || typeof is_checked_in !== 'boolean') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Verify caller is host of this event
  const { data: event } = await supabase
    .from('events')
    .select('host_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!event || event.host_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase
    .from('event_attendees')
    .update({
      is_checked_in,
      checked_in_at: is_checked_in ? new Date().toISOString() : null,
    })
    .eq('event_id', params.id)
    .eq('user_id', attendeeUserId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Stripe dashboard link route**

```ts
// apps/studio/app/api/stripe/dashboard-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-dashboard-link`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (data?.url) {
    return NextResponse.redirect(data.url);
  }
  return NextResponse.json({ error: 'Could not generate dashboard link' }, { status: 500 });
}
```

- [ ] **Step 8: Run tsc in studio**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/app/api/ apps/studio/lib/staff-auth.ts apps/studio/lib/supabase/service.ts
git commit -m "feat(studio): add staff API routes — release-payout, block-payout, cancel-event, checkin, dashboard-link"
```

---

### Task 15: Update `events/page.tsx` and `CreateEventForm.tsx`

**Files:**
- Modify: `apps/studio/app/(dashboard)/events/page.tsx`
- Modify: `apps/studio/app/(dashboard)/events/CreateEventForm.tsx`

- [ ] **Step 1: Update events list — add status badge, attendee count link, fetch status**

Update the events select query and list rendering in `events/page.tsx`:

```ts
  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, is_paid, price_cents, status, attendee_count, communities(name)')
    .in('community_id', communityIds.length ? communityIds : ['none'])
    .order('starts_at', { ascending: false })
    .limit(50);
```

Replace the event list item JSX:

```tsx
            {(events ?? []).map((ev: any) => (
              <li key={ev.id} className="border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <a href={`/events/${ev.id}`} className="font-medium hover:underline">
                    {ev.title}
                  </a>
                  <p className="text-sm text-muted-foreground">
                    {new Date(ev.starts_at).toLocaleDateString('en-US', {
                      weekday: 'short', day: 'numeric', month: 'short',
                      hour: 'numeric', minute: '2-digit',
                    })}{' '}
                    · {ev.communities?.name}
                    {' · '}{ev.attendee_count} going
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={
                    ev.status === 'cancelled' ? 'destructive'
                    : ev.status === 'completed' ? 'secondary'
                    : 'outline'
                  }>
                    {ev.status}
                  </Badge>
                  <Badge variant={ev.is_paid ? 'default' : 'secondary'}>
                    {ev.is_paid ? `$${((ev.price_cents ?? 0) / 100).toFixed(2)}` : 'Free'}
                  </Badge>
                </div>
              </li>
            ))}
```

- [ ] **Step 2: Update CreateEventForm — require ends_at, validate future, lock price after tickets sold**

In `CreateEventForm.tsx`, the form already has `ends_at`. Add these changes:

Add `hasTicketsSold` prop:

```ts
interface Props {
  communities: { id: string; name: string }[];
  stripeConnected: boolean;
  hasTicketsSold?: boolean;
  onCreated?: () => void;
}
```

Add client-side validation in `handleSubmit` before existing validation:

```ts
    if (isPaid) {
      if (!endsAt) {
        setError('Paid events must have an end time.');
        return;
      }
      if (new Date(endsAt) <= new Date()) {
        setError('End time must be in the future.');
        return;
      }
    }
```

Lock price fields when `hasTicketsSold`:

```tsx
              <input
                type="number"
                ...
                disabled={!stripeConnected || !isPaid || hasTicketsSold}
              />
              {hasTicketsSold && (
                <p className="text-xs text-muted-foreground mt-1">
                  Price locked — tickets have been sold.
                </p>
              )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/(dashboard)/events/page.tsx apps/studio/app/(dashboard)/events/CreateEventForm.tsx
git commit -m "feat(studio): events list — status badge, attendee count; CreateEventForm — ends_at required, price lock"
```

---

### Task 16: Event detail page + AttendeeList

**Files:**
- Create: `apps/studio/app/(dashboard)/events/[id]/page.tsx`
- Create: `apps/studio/app/(dashboard)/events/[id]/AttendeeList.tsx`
- Create: `apps/studio/app/(dashboard)/events/[id]/CancelEventButton.tsx`

- [ ] **Step 1: Write event detail page**

```tsx
// apps/studio/app/(dashboard)/events/[id]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { AttendeeList } from './AttendeeList';
import { CancelEventButton } from './CancelEventButton';

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/login');

  const { data: event } = await supabase
    .from('events')
    .select('*, communities(name)')
    .eq('id', params.id)
    .maybeSingle();

  if (!event || event.host_id !== userId) redirect('/events');

  // Check if any tickets sold (locks price editing)
  const { count: ticketCount } = await supabase
    .from('payment_logs')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', params.id)
    .eq('status', 'succeeded');

  const hasTicketsSold = (ticketCount ?? 0) > 0;

  // Revenue summary
  const { data: logs } = await supabase
    .from('payment_logs')
    .select('amount_cents, fee_cents, host_payout_cents, status')
    .eq('event_id', params.id);

  const succeededLogs = (logs ?? []).filter((l: any) => l.status === 'succeeded' || l.status === 'paid_out');
  const grossRevenue = succeededLogs.reduce((s: number, l: any) => s + (l.amount_cents ?? 0), 0);
  const totalFee = succeededLogs.reduce((s: number, l: any) => s + (l.fee_cents ?? 0), 0);
  const hostPayout = succeededLogs.reduce((s: number, l: any) => s + (l.host_payout_cents ?? 0), 0);

  const payoutStatus =
    event.payout_released_at ? 'Released'
    : event.payout_blocked ? 'Blocked'
    : event.status === 'completed' ? 'Processing'
    : event.status === 'cancelled' ? 'Cancelled'
    : 'Waiting for event';

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-muted-foreground mt-1">{event.communities?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={
            event.status === 'cancelled' ? 'destructive'
            : event.status === 'completed' ? 'secondary'
            : 'default'
          }>
            {event.status}
          </Badge>
          {event.status === 'active' && (
            <CancelEventButton eventId={params.id} eventTitle={event.title} refundCount={ticketCount ?? 0} totalRefundCents={grossRevenue} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="border rounded-lg p-4">
          <p className="text-muted-foreground">Starts</p>
          <p className="font-medium">{new Date(event.starts_at).toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-muted-foreground">Ends</p>
          <p className="font-medium">{event.ends_at ? new Date(event.ends_at).toLocaleString() : '—'}</p>
        </div>
      </div>

      {event.is_paid && (
        <div className="border rounded-lg p-6 space-y-3">
          <h2 className="font-semibold">Revenue</h2>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Gross</p>
              <p className="font-bold text-lg">{fmt(grossRevenue)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Platform fee</p>
              <p className="font-medium">{fmt(totalFee)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Your payout</p>
              <p className="font-medium text-green-600">{fmt(hostPayout)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Payout status</p>
              <Badge variant={
                payoutStatus === 'Released' ? 'default'
                : payoutStatus === 'Blocked' ? 'destructive'
                : 'secondary'
              }>{payoutStatus}</Badge>
              {event.payout_released_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(event.payout_released_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-4">Attendees ({event.attendee_count})</h2>
        <AttendeeList eventId={params.id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write AttendeeList client component**

```tsx
// apps/studio/app/(dashboard)/events/[id]/AttendeeList.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Attendee {
  user_id: string;
  ticket_code: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  rsvp_at: string;
  profiles: { display_name: string } | null;
}

const PAGE_SIZE = 50;

export function AttendeeList({ eventId }: { eventId: string }) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const fetchAttendees = useCallback(async (reset = false) => {
    const currentPage = reset ? 0 : page;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('event_attendees')
      .select('user_id, ticket_code, is_checked_in, checked_in_at, rsvp_at, profiles(display_name)')
      .eq('event_id', eventId)
      .order('rsvp_at', { ascending: true })
      .range(from, to);

    if (search) {
      query = query.ilike('ticket_code', `%${search}%`);
    }

    const { data } = await query;
    const rows = (data ?? []) as Attendee[];

    if (reset) {
      setAttendees(rows);
      setPage(1);
    } else {
      setAttendees((prev) => [...prev, ...rows]);
      setPage((p) => p + 1);
    }
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
  }, [eventId, search, page]);

  useEffect(() => {
    setLoading(true);
    fetchAttendees(true);
  }, [search, eventId]);

  const handleCheckIn = async (userId: string, currentlyCheckedIn: boolean) => {
    setCheckingIn(userId);
    const res = await fetch(`/api/events/${eventId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, is_checked_in: !currentlyCheckedIn }),
    });
    if (res.ok) {
      setAttendees((prev) =>
        prev.map((a) =>
          a.user_id === userId
            ? { ...a, is_checked_in: !currentlyCheckedIn, checked_in_at: !currentlyCheckedIn ? new Date().toISOString() : null }
            : a,
        ),
      );
    }
    setCheckingIn(null);
  };

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder="Search by ticket code..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : attendees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No attendees yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Ticket Code</th>
                <th className="text-left p-3 font-medium">RSVP</th>
                <th className="text-left p-3 font-medium">Check-in</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {attendees.map((a) => (
                <tr key={a.user_id} className="border-t">
                  <td className="p-3">{a.profiles?.display_name ?? '—'}</td>
                  <td className="p-3 font-mono text-xs">{a.ticket_code}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(a.rsvp_at).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    {a.is_checked_in ? (
                      <Badge variant="default">Checked In</Badge>
                    ) : (
                      <Badge variant="secondary">Not checked in</Badge>
                    )}
                  </td>
                  <td className="p-3">
                    <Button
                      size="sm"
                      variant={a.is_checked_in ? 'outline' : 'default'}
                      disabled={checkingIn === a.user_id}
                      onClick={() => handleCheckIn(a.user_id, a.is_checked_in)}
                    >
                      {checkingIn === a.user_id ? '...' : a.is_checked_in ? 'Undo' : 'Check In'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => fetchAttendees()}>Load more</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write CancelEventButton**

```tsx
// apps/studio/app/(dashboard)/events/[id]/CancelEventButton.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface Props {
  eventId: string;
  eventTitle: string;
  refundCount: number;
  totalRefundCents: number;
}

export function CancelEventButton({ eventId, eventTitle, refundCount, totalRefundCents }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/cancel`, { method: 'POST' });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError(data.error ?? 'Cancel failed. Please try again.');
      setConfirming(false);
    }
  };

  if (confirming) {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    return (
      <div className="border border-destructive rounded-lg p-4 space-y-3 max-w-sm">
        <p className="text-sm font-medium text-destructive">Cancel this event?</p>
        <p className="text-sm text-muted-foreground">
          This will refund <strong>{refundCount} attendee{refundCount !== 1 ? 's' : ''}</strong> totalling{' '}
          <strong>{fmt(totalRefundCents)}</strong>. This cannot be undone.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleCancel} disabled={loading}>
            {loading ? 'Cancelling...' : 'Yes, Cancel Event'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
            Keep Event
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
      Cancel Event
    </Button>
  );
}
```

- [ ] **Step 4: Run tsc**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/(dashboard)/events/[id]/
git commit -m "feat(studio): event detail page — revenue summary, attendee list, check-in, cancel with confirmation"
```

---

### Task 17: Update `payouts/page.tsx`

**Files:**
- Modify: `apps/studio/app/(dashboard)/payouts/page.tsx`

- [ ] **Step 1: Replace with full reconciliation view**

```tsx
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { redirect } from 'next/navigation';

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function payoutStatusLabel(ev: any): string {
  if (ev.payout_released_at) return 'Released';
  if (ev.payout_blocked) return 'Blocked';
  if (ev.status === 'cancelled') return 'Cancelled';
  if (ev.status === 'completed') return 'Processing';
  return 'Waiting for event';
}

function payoutStatusVariant(label: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (label === 'Released') return 'default';
  if (label === 'Blocked') return 'destructive';
  if (label === 'Cancelled') return 'destructive';
  return 'secondary';
}

export default async function PayoutsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/login');

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete, fee_tier')
    .eq('user_id', userId)
    .maybeSingle();

  if (!stripeAccount?.onboarding_complete) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground">
          Connect and complete Stripe setup in{' '}
          <a href="/settings" className="underline">Settings</a>{' '}
          to see your payout information.
        </p>
      </div>
    );
  }

  // Fetch all paid events hosted by this user
  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, status, payout_released_at, payout_blocked, attendee_count')
    .eq('host_id', userId)
    .eq('is_paid', true)
    .order('starts_at', { ascending: false });

  // Aggregate payment_logs per event
  const eventIds = (events ?? []).map((e: any) => e.id);
  const { data: logs } = await supabase
    .from('payment_logs')
    .select('event_id, amount_cents, fee_cents, host_payout_cents, status')
    .in('event_id', eventIds.length ? eventIds : ['none'])
    .in('status', ['succeeded', 'paid_out']);

  const logsByEvent: Record<string, { gross: number; fee: number; payout: number; count: number }> = {};
  for (const log of logs ?? []) {
    if (!logsByEvent[log.event_id]) {
      logsByEvent[log.event_id] = { gross: 0, fee: 0, payout: 0, count: 0 };
    }
    logsByEvent[log.event_id].gross += log.amount_cents ?? 0;
    logsByEvent[log.event_id].fee += log.fee_cents ?? 0;
    logsByEvent[log.event_id].payout += log.host_payout_cents ?? 0;
    logsByEvent[log.event_id].count += 1;
  }

  const totalEarned = Object.values(logsByEvent).reduce((s, v) => s + v.payout, 0);
  const pending = (events ?? [])
    .filter((e: any) => e.status === 'completed' && !e.payout_released_at && !e.payout_blocked)
    .reduce((s: number, e: any) => s + (logsByEvent[e.id]?.payout ?? 0), 0);
  const released = (events ?? [])
    .filter((e: any) => e.payout_released_at)
    .reduce((s: number, e: any) => s + (logsByEvent[e.id]?.payout ?? 0), 0);

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payouts</h1>
        <a href="/api/stripe/dashboard-link" className="text-sm underline text-primary">
          Open Stripe Dashboard →
        </a>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Earned', value: fmt(totalEarned) },
          { label: 'Pending', value: fmt(pending) },
          { label: 'Released', value: fmt(released) },
        ].map(({ label, value }) => (
          <div key={label} className="border rounded-lg p-4">
            <p className="text-muted-foreground text-sm">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="font-semibold mb-4">Event Payouts</h2>
        {(events ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No paid events yet.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Event</th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Tickets</th>
                  <th className="text-right p-3 font-medium">Gross</th>
                  <th className="text-right p-3 font-medium">Fee</th>
                  <th className="text-right p-3 font-medium">Your Payout</th>
                  <th className="text-left p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((ev: any) => {
                  const agg = logsByEvent[ev.id] ?? { gross: 0, fee: 0, payout: 0, count: 0 };
                  const label = payoutStatusLabel(ev);
                  return (
                    <tr key={ev.id} className="border-t">
                      <td className="p-3">
                        <a href={`/events/${ev.id}`} className="hover:underline font-medium">{ev.title}</a>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(ev.starts_at).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">{agg.count}</td>
                      <td className="p-3 text-right">{fmt(agg.gross)}</td>
                      <td className="p-3 text-right text-muted-foreground">{fmt(agg.fee)}</td>
                      <td className="p-3 text-right font-medium">{fmt(agg.payout)}</td>
                      <td className="p-3">
                        <div>
                          <Badge variant={payoutStatusVariant(label)}>{label}</Badge>
                          {label === 'Blocked' && (
                            <p className="text-xs text-muted-foreground mt-1">Contact support</p>
                          )}
                          {ev.payout_released_at && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(ev.payout_released_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/app/(dashboard)/payouts/page.tsx
git commit -m "feat(studio): payouts — full reconciliation, summary cards, precise status labels, Stripe link wired"
```

---

### Task 18: Staff dashboard

**Files:**
- Create: `apps/studio/app/(dashboard)/staff/page.tsx`
- Create: `apps/studio/app/(dashboard)/staff/PayoutQueueTable.tsx`
- Create: `apps/studio/app/(dashboard)/staff/RefundQueueTable.tsx`

- [ ] **Step 1: Write staff page (server component with auth guard)**

```tsx
// apps/studio/app/(dashboard)/staff/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PayoutQueueTable } from './PayoutQueueTable';
import { RefundQueueTable } from './RefundQueueTable';

export default async function StaffPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.is_staff) redirect('/');

  // Payout queue: completed, unblocked, not released
  const { data: payoutQueue } = await supabase
    .from('events')
    .select('id, title, host_id, status, payout_blocked, payout_released_at, ends_at, currency')
    .eq('status', 'completed')
    .is('payout_released_at', null)
    .order('ends_at', { ascending: true });

  // Refund queue: needs_refund=true with errors
  const { data: refundQueue } = await supabase
    .from('payment_logs')
    .select('id, event_id, payment_intent_id, amount_cents, refund_error, needs_refund, events(title)')
    .eq('needs_refund', true)
    .not('refund_error', 'is', null)
    .order('updated_at', { ascending: false });

  // Dispute queue: payout_blocked events with dispute audit entries
  const { data: disputeAudit } = await supabase
    .from('audit_log')
    .select('target_id, metadata, created_at')
    .eq('action', 'block_payout')
    .eq('target_type', 'event')
    .filter('metadata->>reason', 'eq', 'dispute')
    .order('created_at', { ascending: false });

  const disputeEventIds = (disputeAudit ?? []).map((a: any) => a.target_id);
  const { data: disputeEvents } = disputeEventIds.length ? await supabase
    .from('events')
    .select('id, title, payout_blocked')
    .in('id', disputeEventIds) : { data: [] };

  return (
    <div className="space-y-10 max-w-5xl">
      <h1 className="text-2xl font-bold">Staff Dashboard</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Payout Queue ({(payoutQueue ?? []).length})</h2>
        {(payoutQueue ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No items — you're all clear.</p>
        ) : (
          <PayoutQueueTable events={payoutQueue ?? []} />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Dispute Queue ({(disputeEvents ?? []).length})</h2>
        {(disputeEvents ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No disputes — you're all clear.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Event</th>
                  <th className="text-left p-3 font-medium">Dispute logged</th>
                  <th className="text-left p-3 font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {(disputeEvents ?? []).map((ev: any) => {
                  const audit = (disputeAudit ?? []).find((a: any) => a.target_id === ev.id);
                  return (
                    <tr key={ev.id} className="border-t">
                      <td className="p-3"><a href={`/events/${ev.id}`} className="hover:underline">{ev.title}</a></td>
                      <td className="p-3 text-muted-foreground">
                        {audit ? new Date(audit.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3">{ev.payout_blocked ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Refund Queue ({(refundQueue ?? []).length})</h2>
        {(refundQueue ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No failed refunds — you're all clear.</p>
        ) : (
          <RefundQueueTable rows={refundQueue ?? []} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Write PayoutQueueTable**

```tsx
// apps/studio/app/(dashboard)/staff/PayoutQueueTable.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

interface Event {
  id: string;
  title: string;
  payout_blocked: boolean;
  ends_at: string | null;
}

export function PayoutQueueTable({ events }: { events: Event[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const releaseNow = async (eventId: string) => {
    setLoading(eventId);
    setError(null);
    const res = await fetch('/api/staff/release-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId }),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) setError(data.error ?? 'Release failed');
    else router.refresh();
  };

  const toggleBlock = async (eventId: string, block: boolean) => {
    setLoading(eventId);
    setError(null);
    const res = await fetch('/api/staff/block-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, blocked: block }),
    });
    setLoading(null);
    if (!res.ok) setError('Action failed');
    else router.refresh();
  };

  return (
    <div>
      {error && <p className="text-sm text-destructive mb-2">{error}</p>}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-3 font-medium">Event</th>
              <th className="text-left p-3 font-medium">Ended</th>
              <th className="text-left p-3 font-medium">Blocked</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} className="border-t">
                <td className="p-3">
                  <a href={`/events/${ev.id}`} className="hover:underline">{ev.title}</a>
                </td>
                <td className="p-3 text-muted-foreground">
                  {ev.ends_at ? new Date(ev.ends_at).toLocaleDateString() : '—'}
                </td>
                <td className="p-3">
                  <Badge variant={ev.payout_blocked ? 'destructive' : 'secondary'}>
                    {ev.payout_blocked ? 'Blocked' : 'No'}
                  </Badge>
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={ev.payout_blocked || loading === ev.id}
                      onClick={() => releaseNow(ev.id)}
                    >
                      {loading === ev.id ? '...' : 'Release Now'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading === ev.id}
                      onClick={() => toggleBlock(ev.id, !ev.payout_blocked)}
                    >
                      {ev.payout_blocked ? 'Unblock' : 'Block'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write RefundQueueTable**

```tsx
// apps/studio/app/(dashboard)/staff/RefundQueueTable.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface RefundRow {
  id: string;
  event_id: string;
  payment_intent_id: string;
  amount_cents: number;
  refund_error: string;
  events: { title: string } | null;
}

export function RefundQueueTable({ rows }: { rows: RefundRow[] }) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  const retry = async (paymentLogId: string) => {
    setLoading(paymentLogId);
    // Trigger process-refunds for this specific row by clearing refund_error
    // so the next cron pick-up retries it. Staff can also just wait for cron.
    // For immediate retry, call process-refunds via staff endpoint.
    await fetch('/api/staff/release-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_refunds: true }),
    });
    setLoading(null);
    router.refresh();
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-3 font-medium">Event</th>
            <th className="text-left p-3 font-medium">Amount</th>
            <th className="text-left p-3 font-medium">Error</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3">{r.events?.title ?? r.event_id}</td>
              <td className="p-3">${((r.amount_cents ?? 0) / 100).toFixed(2)}</td>
              <td className="p-3 text-destructive font-mono text-xs">{r.refund_error}</td>
              <td className="p-3">
                <Button size="sm" variant="outline" disabled={loading === r.id} onClick={() => retry(r.id)}>
                  {loading === r.id ? '...' : 'Retry'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Add staff link to Studio sidebar**

Find the sidebar nav component in `apps/studio/components/` and add a staff link that shows only when `is_staff=true`. The staff link routes to `/staff`.

- [ ] **Step 5: Run tsc**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/app/(dashboard)/staff/
git commit -m "feat(studio): staff dashboard — payout queue, dispute queue, refund queue with actions"
```

---

## Phase 5 — Tests

### Task 19: Mobile unit tests

**Files:**
- Modify: `apps/mobile/__tests__/lib/stripe.test.ts`

- [ ] **Step 1: Add sold-out and cleanup tests**

```ts
// Append to existing stripe.test.ts
describe('purchaseTicket soldOut path', () => {
  it('returns soldOut:true when edge function returns sold_out error', async () => {
    jest.mock('../../lib/supabase', () => ({
      callEdgeFunction: jest.fn().mockResolvedValue({ data: null, error: 'sold_out' }),
      supabase: { channel: jest.fn(() => ({ on: jest.fn(() => ({ subscribe: jest.fn() })) })), removeChannel: jest.fn() },
    }));
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase');
    // Re-import to pick up mock
    const { purchaseTicket } = await import('../../lib/stripe');
    const result = await purchaseTicket('00000000-0000-0000-0000-000000000001', jest.fn(), jest.fn(), 'user-1');
    expect(result.soldOut).toBe(true);
    expect(result.success).toBe(false);
  });
});

describe('subscribeToTicket', () => {
  it('returns an unsubscribe function that removes the channel', () => {
    const mockRemove = jest.fn();
    const mockChannel = {
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    };
    jest.mock('../../lib/supabase', () => ({
      supabase: {
        channel: jest.fn(() => mockChannel),
        removeChannel: mockRemove,
      },
    }));
    const { supabase } = jest.requireMock('../../lib/supabase');
    const { subscribeToTicket } = require('../../lib/stripe');
    const unsub = subscribeToTicket('event-1', 'user-1', jest.fn());
    unsub();
    expect(mockRemove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/__tests__/lib/stripe.test.ts
git commit -m "test(mobile): add soldOut path and subscribeToTicket cleanup tests"
```

---

### Task 20: QA loop

- [ ] **Step 1: Lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0
cd apps/studio && npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 warnings, 0 errors.

- [ ] **Step 2: TypeScript — mobile**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: TypeScript — studio**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: all pass.

- [ ] **Step 5: Deploy edge functions to remote**

```bash
npx supabase functions deploy cancel-event --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy process-refunds --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy release-payout --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy auto-complete-events --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy create-payment-intent --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy stripe-webhooks --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 6: Set remote secrets**

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_live_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set ONESIGNAL_REST_API_KEY=... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set ONESIGNAL_APP_ID=... --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 7: Push migration to remote**

```bash
npx supabase db push --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: QA loop complete — lint, tsc, jest all pass"
```
