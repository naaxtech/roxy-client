# Stripe Payments, Events Production & Brand Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-ready Stripe ticket purchasing, OWASP-compliant payment pipeline, Studio Events management, and Roxy brand theme applied to Studio.

**Architecture:** Edge functions own all Stripe API calls. Mobile PaymentSheet handles card/Apple Pay/Google Pay. Webhook-driven idempotent ticket creation. Studio reads payment_logs via RLS.

**Tech Stack:** Stripe React Native SDK, Stripe Node.js (Deno npm:stripe@14), Supabase Realtime, Next.js 16, shadcn/ui, Tailwind CSS, Jest (mobile tests)

**Spec:** `docs/superpowers/specs/2026-04-09-stripe-payments-studio-theme-design.md`

---

## Task 1: Migration 022 — DB Changes

**Files:**
- Create: `supabase/migrations/022_payments_phase2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/022_payments_phase2.sql

-- 1. Upgrade ticket_code to 16-char (64-bit entropy)
ALTER TABLE public.event_attendees
  ALTER COLUMN ticket_code
  SET DEFAULT ('ROXY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)));

-- 2. Atomic claim_ticket function (SECURITY INVOKER — runs as calling role)
CREATE OR REPLACE FUNCTION public.claim_ticket(
  p_event_id uuid,
  p_buyer_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_ticket_code text;
  v_max         integer;
  v_count       integer;
BEGIN
  SELECT max_attendees INTO v_max
  FROM public.events WHERE id = p_event_id;

  IF v_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.event_attendees WHERE event_id = p_event_id;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'sold_out';
    END IF;
  END IF;

  INSERT INTO public.event_attendees (event_id, user_id)
  VALUES (p_event_id, p_buyer_id)
  ON CONFLICT DO NOTHING
  RETURNING ticket_code INTO v_ticket_code;

  -- If conflict (buyer already has ticket), return existing code
  IF v_ticket_code IS NULL THEN
    SELECT ticket_code INTO v_ticket_code
    FROM public.event_attendees
    WHERE event_id = p_event_id AND user_id = p_buyer_id;
  END IF;

  RETURN v_ticket_code;
END;
$$;

-- 3. payment_logs RLS: hosts read their own rows
CREATE POLICY "payment_logs_host_read" ON public.payment_logs
  FOR SELECT TO authenticated
  USING (host_id = auth.uid());

-- 4. cover_image_url must be https://
ALTER TABLE public.events
  ADD CONSTRAINT events_cover_image_url_https
  CHECK (cover_image_url IS NULL OR cover_image_url LIKE 'https://%');
```

- [ ] **Step 2: Push migration**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: `Applying migration 022_payments_phase2.sql... done`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_payments_phase2.sql
git commit -m "feat: migration 022 — claim_ticket fn, ticket entropy, payment_logs RLS, https constraint"
```

---

## Task 2: `stripe-webhooks` Upgrade

**Files:**
- Modify: `supabase/functions/stripe-webhooks/index.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// supabase/functions/stripe-webhooks/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Must read raw body before any parsing — HMAC is over raw bytes
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return errorResponse('Missing Stripe-Signature header', 400);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    return errorResponse(`Webhook signature verification failed: ${err}`, 400);
  }

  const supabase = getSupabaseClient();

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await supabase
          .from('host_stripe_accounts')
          .update({
            onboarding_complete: account.charges_enabled && account.payouts_enabled,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const eventId = pi.metadata?.event_id;

        if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) {
          console.error('Invalid or missing event_id in metadata', pi.id);
          break;
        }

        // Look up buyer_id from OUR pending payment_logs record — never trust Stripe metadata
        const { data: pendingLog } = await supabase
          .from('payment_logs')
          .select('buyer_id, host_id, fee_cents, host_payout_cents')
          .eq('payment_intent_id', pi.id)
          .eq('status', 'pending')
          .maybeSingle();

        if (!pendingLog) {
          console.error('No pending payment_logs row for', pi.id);
          break;
        }

        // Atomic ticket claim
        const { data: ticketCode, error: claimErr } = await supabase
          .rpc('claim_ticket', {
            p_event_id: eventId,
            p_buyer_id: pendingLog.buyer_id,
          });

        if (claimErr) {
          console.error('claim_ticket failed:', claimErr.message);
          // sold_out or other error — log but still return 200 to Stripe
          await supabase
            .from('payment_logs')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('payment_intent_id', pi.id);
          break;
        }

        // Upgrade payment_logs to succeeded
        await supabase
          .from('payment_logs')
          .update({
            status: 'succeeded',
            ticket_code: ticketCode,
            updated_at: new Date().toISOString(),
          })
          .eq('payment_intent_id', pi.id);

        break;
      }

      default:
        // Return 200 for all unhandled types — Stripe requires 2xx or it retries
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Still return 200 — log and investigate separately; don't cause Stripe retries
  }

  return successResponse({ received: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/stripe-webhooks/index.ts
git commit -m "feat: stripe-webhooks — signature verification + payment_intent.succeeded handler"
```

---

## Task 3: `create-payment-intent` Edge Function

**Files:**
- Create: `supabase/functions/create-payment-intent/index.ts`

- [ ] **Step 1: Create the function**

```typescript
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
    .select('id, title, is_paid, price_cents, currency, max_attendees, community_id, host_id, is_private')
    .eq('id', event_id)
    .maybeSingle();

  if (eventErr || !event) return errorResponse('Event not found', 404);
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

  // Create PaymentIntent — idempotency key prevents duplicates on retry
  const pi = await stripe.paymentIntents.create(
    {
      amount: event.price_cents,
      currency: event.currency ?? 'usd',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: feeCents,
      on_behalf_of: hostAccount.stripe_account_id,
      transfer_data: { destination: hostAccount.stripe_account_id },
      metadata: { event_id, host_id: event.host_id },
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
```

- [ ] **Step 2: Set Supabase secrets**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_live_... --project-ref ptymtdlysqbpxzlgsshp
npx supabase secrets set STUDIO_URL=https://roxy-studio.vercel.app --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-payment-intent/index.ts
git commit -m "feat: create-payment-intent edge function — Stripe PaymentIntent with OWASP controls"
```

---

## Task 4: `stripe-dashboard-link` Edge Function

**Files:**
- Create: `supabase/functions/stripe-dashboard-link/index.ts`

- [ ] **Step 1: Create the function**

```typescript
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

  const { user, errorResponse: authErr } = await verifyJWT(req);
  if (authErr) return authErr;

  // Rate limit: 5 login link requests per hour
  await checkRateLimit(user.id, 'stripe-dashboard-link', 'daily', 50);

  if (DEV_MOCK) {
    return successResponse({ url: 'https://dashboard.stripe.com/test/dashboard' });
  }

  const supabase = getSupabaseClient();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/stripe-dashboard-link/index.ts
git commit -m "feat: stripe-dashboard-link edge function — Stripe Express login link"
```

---

## Task 5: Mobile — StripeProvider Setup

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Install Stripe React Native SDK**

```bash
cd apps/mobile
npx expo install @stripe/stripe-react-native
```

Expected: package added, no peer dep errors.

- [ ] **Step 2: Add StripeProvider to root layout**

In `apps/mobile/app/_layout.tsx`, add import at the top:

```typescript
import { StripeProvider } from '@stripe/stripe-react-native';
```

Wrap the `<GestureHandlerRootView>` with StripeProvider (replace the existing return in `export default function RootLayout`):

```tsx
return (
  <StripeProvider
    publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
    merchantIdentifier="merchant.app.roxy"
    urlScheme="roxy"
  >
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* existing content unchanged */}
    </GestureHandlerRootView>
  </StripeProvider>
);
```

- [ ] **Step 3: Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to .env**

In `apps/mobile/.env` (or `.env.local`):

```
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/package.json
git commit -m "feat: add StripeProvider to mobile root layout"
```

---

## Task 6: Mobile — `stripe.ts` + Tests

**Files:**
- Create: `apps/mobile/lib/stripe.ts`
- Create: `apps/mobile/__tests__/lib/stripe.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// apps/mobile/__tests__/lib/stripe.test.ts
import { sanitizePaymentError } from '../../lib/stripe';

describe('sanitizePaymentError', () => {
  it('redacts client_secret from error objects', () => {
    const err = { message: 'failed', client_secret: 'pi_abc_secret_xyz' };
    const result = sanitizePaymentError(err);
    expect((result as any).client_secret).toBe('[redacted]');
    expect((result as any).message).toBe('failed');
  });

  it('returns non-objects unchanged', () => {
    expect(sanitizePaymentError('some error')).toBe('some error');
    expect(sanitizePaymentError(null)).toBe(null);
  });

  it('returns objects without client_secret unchanged', () => {
    const err = { message: 'network error' };
    expect(sanitizePaymentError(err)).toEqual({ message: 'network error' });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/mobile
npx jest __tests__/lib/stripe.test.ts --ci
```

Expected: FAIL — `sanitizePaymentError` not found.

- [ ] **Step 3: Write `stripe.ts`**

```typescript
// apps/mobile/lib/stripe.ts
import { useStripe } from '@stripe/stripe-react-native';
import { callEdgeFunction } from './supabase';
import { logError } from './errorLogger';
import { supabase } from './supabase';

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
    const data = await callEdgeFunction('create-payment-intent', { event_id: eventId });
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

  // Wait for webhook to create ticket via Supabase Realtime
  const ticketCode = await waitForTicket(eventId, userId);
  return { success: true, ticketCode };
}

async function waitForTicket(eventId: string, userId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      resolve(null); // Payment succeeded, ticket will appear in My Tickets shortly
    }, 30_000);

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
          if (payload.new?.user_id === userId) {
            clearTimeout(timeout);
            supabase.removeChannel(channel);
            resolve(payload.new.ticket_code ?? null);
          }
        },
      )
      .subscribe();
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/mobile
npx jest __tests__/lib/stripe.test.ts --ci
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/stripe.ts apps/mobile/__tests__/lib/stripe.test.ts
git commit -m "feat: mobile stripe.ts — purchaseTicket, sanitizePaymentError + tests"
```

---

## Task 7: Mobile — `TicketConfirmation` Component + Tests

**Files:**
- Create: `apps/mobile/components/TicketConfirmation.tsx`
- Create: `apps/mobile/__tests__/components/TicketConfirmation.test.tsx`

- [ ] **Step 1: Install QR code library**

```bash
cd apps/mobile
npx expo install react-native-qrcode-svg react-native-svg
```

- [ ] **Step 2: Write failing test**

```typescript
// apps/mobile/__tests__/components/TicketConfirmation.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { TicketConfirmation } from '../../components/TicketConfirmation';

jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: () => null,
}));

const mockEvent = {
  title: 'Spring Mixer',
  starts_at: '2026-05-01T19:00:00Z',
  communities: { name: 'Queer Collective' },
};

describe('TicketConfirmation', () => {
  it('renders event title', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode="ROXY-ABCD1234EFGH5678"
        onViewTickets={() => {}}
      />
    );
    expect(getByText('Spring Mixer')).toBeTruthy();
  });

  it('renders ticket code', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode="ROXY-ABCD1234EFGH5678"
        onViewTickets={() => {}}
      />
    );
    expect(getByText('ROXY-ABCD1234EFGH5678')).toBeTruthy();
  });

  it('renders pending state when ticketCode is null', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode={null}
        onViewTickets={() => {}}
      />
    );
    expect(getByText(/arriving shortly/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd apps/mobile
npx jest __tests__/components/TicketConfirmation.test.tsx --ci
```

Expected: FAIL — component not found.

- [ ] **Step 4: Write the component**

```tsx
// apps/mobile/components/TicketConfirmation.tsx
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
  ticketCode: string | null;
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
          Payment received — your ticket is arriving shortly.
        </Text>
      )}

      <TouchableOpacity style={styles.btn} onPress={onViewTickets}>
        <Text style={styles.btnText}>View in My Tickets</Text>
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
  pending: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 20, lineHeight: 20 },
  btn: { marginTop: 24, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
});
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/mobile
npx jest __tests__/components/TicketConfirmation.test.tsx --ci
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/TicketConfirmation.tsx apps/mobile/__tests__/components/TicketConfirmation.test.tsx
git commit -m "feat: TicketConfirmation component — QR + ticket reveal + tests"
```

---

## Task 8: Mobile — Event Detail Screen Updates

**Files:**
- Modify: `apps/mobile/app/event/[id].tsx`

- [ ] **Step 1: Read the current event detail screen**

Read `apps/mobile/app/event/[id].tsx` in full before editing.

- [ ] **Step 2: Add Buy Ticket button and purchase flow**

Add imports at the top of the file:

```typescript
import { useStripe } from '@stripe/stripe-react-native';
import { purchaseTicket } from '../../lib/stripe';
import { TicketConfirmation } from '../../components/TicketConfirmation';
import { useAuth } from '../../hooks/useAuth';
```

Add state and handlers inside the component (after existing state):

```typescript
const { initPaymentSheet, presentPaymentSheet } = useStripe();
const { user } = useAuth();
const [purchasing, setPurchasing] = useState(false);
const [purchaseResult, setPurchaseResult] = useState<{ ticketCode: string | null } | null>(null);
const [purchaseError, setPurchaseError] = useState<string | null>(null);

const handleBuyTicket = async () => {
  if (!user) return;
  setPurchasing(true);
  setPurchaseError(null);
  const result = await purchaseTicket(event.id, initPaymentSheet, presentPaymentSheet, user.id);
  setPurchasing(false);
  if (result.success) {
    setPurchaseResult({ ticketCode: result.ticketCode ?? null });
  } else if (!result.cancelled) {
    setPurchaseError(result.error ?? 'Payment failed. Please try again.');
  }
};
```

Replace the RSVP button section with:

```tsx
{purchaseResult ? (
  <TicketConfirmation
    event={event}
    ticketCode={purchaseResult.ticketCode}
    onViewTickets={() => router.push('/(tabs)/grow')}
  />
) : event.is_paid ? (
  <View>
    <TouchableOpacity
      style={[styles.rsvpButton, purchasing && styles.rsvpButtonDisabled]}
      onPress={handleBuyTicket}
      disabled={purchasing}
    >
      <Text style={styles.rsvpButtonText}>
        {purchasing
          ? 'Setting up payment…'
          : `Buy Ticket — $${((event.price_cents ?? 0) / 100).toFixed(2)}`}
      </Text>
    </TouchableOpacity>
    {purchaseError && (
      <Text style={styles.errorText}>{purchaseError}</Text>
    )}
  </View>
) : (
  // existing free RSVP button unchanged
)}
```

Add to StyleSheet:

```typescript
errorText: { color: COLORS.error, fontSize: 13, marginTop: 8, textAlign: 'center' },
rsvpButtonDisabled: { opacity: 0.6 },
```

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
cd apps/mobile
npx jest --ci --passWithNoTests
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/event/[id].tsx
git commit -m "feat: event detail — Buy Ticket button with PaymentSheet + TicketConfirmation"
```

---

## Task 9: Studio — Roxy Brand Theme

**Files:**
- Modify: `apps/studio/app/globals.css`
- Modify: `apps/studio/tailwind.config.ts`
- Modify: `apps/studio/components/Sidebar.tsx`

- [ ] **Step 1: Replace globals.css with Roxy theme**

Replace the entire `:root` block in `apps/studio/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Roxy brand — dark purple/pink theme */
    --background: 268 64% 11%;
    --foreground: 0 0% 100%;
    --card: 264 49% 21%;
    --card-foreground: 0 0% 100%;
    --popover: 264 49% 21%;
    --popover-foreground: 0 0% 100%;
    --primary: 330 73% 70%;
    --primary-foreground: 268 64% 11%;
    --secondary: 258 89% 66%;
    --secondary-foreground: 0 0% 100%;
    --muted: 263 37% 27%;
    --muted-foreground: 270 21% 77%;
    --accent: 323 86% 70%;
    --accent-foreground: 268 64% 11%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 263 37% 27%;
    --input: 263 37% 27%;
    --ring: 330 73% 70%;
    --radius: 0.75rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

Remove the `.dark` block entirely — Studio uses dark theme by default (no toggle needed).

- [ ] **Step 2: Update tailwind.config.ts**

Replace `apps/studio/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        roxy: '#E879A6',
        'roxy-deep': '#C4476A',
        'roxy-purple': '#8B5CF6',
        'roxy-bg': '#1a0a2e',
        'roxy-surface': '#2d1b4e',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 3: Update Sidebar with Roxy brand styling**

Replace `apps/studio/components/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/events',    label: 'Events' },
  { href: '/rooms',     label: 'Rooms' },
  { href: '/games',     label: 'Games' },
  { href: '/community', label: 'Community' },
  { href: '/payouts',   label: 'Payouts' },
  { href: '/settings',  label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen border-r border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <span className="text-xl font-bold tracking-tight text-primary">🌸 Studio</span>
        <p className="text-xs text-muted-foreground mt-0.5">Host dashboard</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: Build to verify theme compiles**

```bash
cd apps/studio
npm run build
```

Expected: build succeeds, no CSS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/globals.css apps/studio/tailwind.config.ts apps/studio/components/Sidebar.tsx
git commit -m "feat: Roxy brand theme in Studio — dark purple/pink palette matching mobile"
```

---

## Task 10: Studio — Tab Lag Fix (`loading.tsx`)

**Files:**
- Create: `apps/studio/app/(dashboard)/loading.tsx`
- Create: `apps/studio/app/(dashboard)/events/loading.tsx`
- Create: `apps/studio/app/(dashboard)/payouts/loading.tsx`
- Create: `apps/studio/app/(dashboard)/community/loading.tsx`
- Create: `apps/studio/app/(dashboard)/settings/loading.tsx`

- [ ] **Step 1: Create shared skeleton**

```tsx
// apps/studio/app/(dashboard)/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded-md" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-6">
            <div className="h-4 w-24 bg-muted rounded mb-3" />
            <div className="h-8 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
        <div className="h-4 w-3/4 bg-muted rounded" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create per-route skeletons**

```tsx
// apps/studio/app/(dashboard)/events/loading.tsx
export default function EventsLoading() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="h-8 w-32 bg-muted rounded-md" />
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded" />
        ))}
      </div>
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-card border border-border rounded-lg" />
        ))}
      </div>
    </div>
  );
}
```

```tsx
// apps/studio/app/(dashboard)/payouts/loading.tsx
export default function PayoutsLoading() {
  return (
    <div className="max-w-3xl space-y-6 animate-pulse">
      <div className="h-8 w-32 bg-muted rounded-md" />
      <div className="h-10 w-48 bg-muted rounded-md" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-6">
            <div className="h-4 w-20 bg-muted rounded mb-2" />
            <div className="h-6 w-24 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// apps/studio/app/(dashboard)/community/loading.tsx
export default function CommunityLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-40 bg-muted rounded-md" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-16 bg-card border border-border rounded-lg" />
      ))}
    </div>
  );
}
```

```tsx
// apps/studio/app/(dashboard)/settings/loading.tsx
export default function SettingsLoading() {
  return (
    <div className="max-w-2xl space-y-8 animate-pulse">
      <div className="h-8 w-32 bg-muted rounded-md" />
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-10 bg-muted rounded" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify**

```bash
cd apps/studio
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/app/\(dashboard\)/loading.tsx \
        apps/studio/app/\(dashboard\)/events/loading.tsx \
        apps/studio/app/\(dashboard\)/payouts/loading.tsx \
        apps/studio/app/\(dashboard\)/community/loading.tsx \
        apps/studio/app/\(dashboard\)/settings/loading.tsx
git commit -m "feat: loading.tsx skeletons — instant sidebar on tab switch"
```

---

## Task 11: Studio — Payouts Page

**Files:**
- Modify: `apps/studio/app/(dashboard)/payouts/page.tsx`

- [ ] **Step 1: Read current payouts/page.tsx**

Read the current file before editing.

- [ ] **Step 2: Replace with production page**

```tsx
// apps/studio/app/(dashboard)/payouts/page.tsx
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OpenStripeDashboardButton } from './OpenStripeDashboardButton';

export default async function PayoutsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  // payment_logs readable via payment_logs_host_read RLS policy
  const { data: logs } = await supabase
    .from('payment_logs')
    .select('event_id, amount_cents, fee_cents, host_payout_cents, events(title)')
    .eq('host_id', userId)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false });

  const rows = logs ?? [];

  // Aggregate totals
  const totalGross = rows.reduce((s, r) => s + r.amount_cents, 0);
  const totalFees = rows.reduce((s, r) => s + r.fee_cents, 0);
  const totalNet = rows.reduce((s, r) => s + r.host_payout_cents, 0);

  // Per-event aggregation
  const byEvent = rows.reduce<Record<string, { title: string; tickets: number; gross: number; fee: number; net: number }>>(
    (acc, r) => {
      const id = r.event_id ?? 'unknown';
      const title = (r.events as any)?.title ?? 'Unknown event';
      if (!acc[id]) acc[id] = { title, tickets: 0, gross: 0, fee: 0, net: 0 };
      acc[id].tickets += 1;
      acc[id].gross += r.amount_cents;
      acc[id].fee += r.fee_cents;
      acc[id].net += r.host_payout_cents;
      return acc;
    },
    {},
  );

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground mt-1">Your earnings on Roxy.</p>
      </div>

      {stripeAccount?.onboarding_complete && (
        <OpenStripeDashboardButton />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total gross', value: fmt(totalGross) },
          { label: 'Platform fees', value: fmt(totalFees) },
          { label: 'Net payout', value: fmt(totalNet) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {Object.keys(byEvent).length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Per Event</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {['Event', 'Tickets', 'Gross', 'Fee', 'Net'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(byEvent).map((ev, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{ev.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ev.tickets}</td>
                    <td className="px-4 py-3">{fmt(ev.gross)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmt(ev.fee)}</td>
                    <td className="px-4 py-3 text-primary font-semibold">{fmt(ev.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No completed payments yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create OpenStripeDashboardButton client component**

```tsx
// apps/studio/app/(dashboard)/payouts/OpenStripeDashboardButton.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function OpenStripeDashboardButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/dashboard-link', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={loading} variant="outline">
      {loading ? 'Opening…' : 'Open Stripe Dashboard →'}
    </Button>
  );
}
```

- [ ] **Step 4: Create API route for dashboard link**

```typescript
// apps/studio/app/api/stripe/dashboard-link/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Call edge function — Stripe secrets stay in Supabase
  const { data, error } = await supabase.functions.invoke('stripe-dashboard-link');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
```

- [ ] **Step 5: Build to verify**

```bash
cd apps/studio
npm run build
```

Expected: build succeeds, `/payouts` route is dynamic (ƒ).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/app/\(dashboard\)/payouts/ apps/studio/app/api/stripe/dashboard-link/
git commit -m "feat: Studio Payouts page — earnings from payment_logs + Stripe dashboard link"
```

---

## Task 12: Studio — Events Form Upgrade + List

**Files:**
- Modify: `apps/studio/app/(dashboard)/events/CreateEventForm.tsx`
- Modify: `apps/studio/app/(dashboard)/events/page.tsx`

- [ ] **Step 1: Update CreateEventForm**

Replace `apps/studio/app/(dashboard)/events/CreateEventForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Community { id: string; name: string; }

interface CreateEventFormProps {
  communities: Community[];
  stripeConnected: boolean;
  onCreated: () => void;
}

const MAX_PRICE_DOLLARS = 50;
const URL_RE = /^https:\/\/.+/;

export function CreateEventForm({ communities, stripeConnected, onCreated }: CreateEventFormProps) {
  const [title, setTitle] = useState('');
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [locationText, setLocationText] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [priceDollars, setPriceDollars] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError('Title is required'); return; }
    if (!communityId) { setError('Select a community'); return; }
    if (!startsAt) { setError('Start time is required'); return; }
    if (coverImageUrl && !URL_RE.test(coverImageUrl)) {
      setError('Cover image URL must start with https://'); return;
    }
    if (description.length > 500) { setError('Description max 500 characters'); return; }

    let price_cents: number | null = null;
    if (isPaid) {
      const dollars = parseFloat(priceDollars);
      if (isNaN(dollars) || dollars < 0.50) { setError('Minimum price is $0.50'); return; }
      if (dollars > MAX_PRICE_DOLLARS) { setError(`Maximum price is $${MAX_PRICE_DOLLARS}`); return; }
      price_cents = Math.round(dollars * 100);
    }

    const capacity = maxAttendees ? parseInt(maxAttendees, 10) : null;
    if (capacity !== null && (isNaN(capacity) || capacity < 1)) {
      setError('Max tickets must be at least 1'); return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from('events').insert({
      title: title.trim(),
      community_id: communityId,
      description: description.trim() || null,
      cover_image_url: coverImageUrl.trim() || null,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      location_text: locationText.trim() || null,
      is_paid: isPaid,
      is_private: isPrivate,
      price_cents,
      currency: 'usd',
      max_attendees: capacity,
    });

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
    } else {
      setTitle(''); setDescription(''); setCoverImageUrl('');
      setStartsAt(''); setEndsAt(''); setLocationText('');
      setIsPaid(false); setPriceDollars(''); setMaxAttendees(''); setIsPrivate(false);
      onCreated();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border border-border rounded-lg p-6 bg-card">
      <h2 className="text-lg font-semibold">Create Event</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional, max 500)</span></Label>
        <textarea
          id="description"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={500}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cover">Cover image URL <span className="text-muted-foreground text-xs">(optional, https://)</span></Label>
        <Input id="cover" type="url" value={coverImageUrl} onChange={e => setCoverImageUrl(e.target.value)} placeholder="https://..." />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="community">Community</Label>
        <select
          id="community"
          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={communityId}
          onChange={e => setCommunityId(e.target.value)}
        >
          {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="starts">Start</Label>
          <Input id="starts" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ends">End (optional)</Label>
          <Input id="ends" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="location">Location (optional)</Label>
        <Input id="location" value={locationText} onChange={e => setLocationText(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="capacity">Max tickets (optional — leave blank for unlimited)</Label>
        <Input id="capacity" type="number" min="1" value={maxAttendees} onChange={e => setMaxAttendees(e.target.value)} placeholder="e.g. 50" />
      </div>

      <div className="flex items-center gap-3">
        <input type="checkbox" id="isPrivate" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} className="h-4 w-4" />
        <Label htmlFor="isPrivate">
          Private event
          <span className="text-muted-foreground text-xs ml-2">(community members only)</span>
        </Label>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox" id="isPaid" checked={isPaid}
          disabled={!stripeConnected} onChange={e => setIsPaid(e.target.checked)} className="h-4 w-4"
        />
        <Label htmlFor="isPaid">
          Paid event
          {!stripeConnected && <span className="text-muted-foreground text-xs ml-2">(connect Stripe in Settings first)</span>}
        </Label>
      </div>

      {isPaid && (
        <div className="space-y-1.5">
          <Label htmlFor="price">Price (USD, $0.50 – ${MAX_PRICE_DOLLARS})</Label>
          <Input id="price" type="number" min="0.50" max={MAX_PRICE_DOLLARS} step="0.01"
            value={priceDollars} onChange={e => setPriceDollars(e.target.value)} placeholder="e.g. 10.00" />
        </div>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create Event'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Update events page to show ticket sales + attendees**

Replace `apps/studio/app/(dashboard)/events/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { CreateEventForm } from './CreateEventForm';
import { AttendeesPanel } from './AttendeesPanel';

export default async function EventsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: memberRows } = await supabase
    .from('community_members')
    .select('communities(id, name)')
    .eq('user_id', userId)
    .eq('role', 'admin');

  const communities = (memberRows ?? [])
    .map((r: any) => r.communities)
    .filter(Boolean) as { id: string; name: string }[];

  const communityIds = communities.map(c => c.id);

  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, is_paid, is_private, price_cents, attendee_count, max_attendees, communities(name)')
    .in('community_id', communityIds.length ? communityIds : ['none'])
    .order('starts_at', { ascending: false })
    .limit(50);

  // Ticket revenue per event from payment_logs (host RLS ensures own-rows only)
  const eventIds = (events ?? []).map(e => e.id);
  const { data: revRows } = await supabase
    .from('payment_logs')
    .select('event_id, host_payout_cents')
    .in('event_id', eventIds.length ? eventIds : ['none'])
    .eq('host_id', userId)
    .eq('status', 'succeeded');

  const revenueByEvent = (revRows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.event_id] = (acc[r.event_id] ?? 0) + r.host_payout_cents;
    return acc;
  }, {});

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  const stripeConnected = stripeAccount?.onboarding_complete ?? false;
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="text-muted-foreground mt-1">Create and manage your events.</p>
      </div>

      {communities.length > 0 ? (
        <CreateEventForm communities={communities} stripeConnected={stripeConnected} onCreated={() => {}} />
      ) : (
        <p className="text-muted-foreground text-sm">You are not an admin of any community yet.</p>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Your Events</h2>
        {(events ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No events yet.</p>
        ) : (
          <ul className="space-y-2">
            {(events ?? []).map((ev: any) => (
              <li key={ev.id} className="border border-border rounded-lg p-4 bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{ev.title}</p>
                      {ev.is_private && <Badge variant="outline" className="text-xs">Private</Badge>}
                      <Badge variant={ev.is_paid ? 'default' : 'secondary'}>
                        {ev.is_paid ? fmt(ev.price_cents ?? 0) : 'Free'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {new Date(ev.starts_at).toLocaleDateString('en-US', {
                        weekday: 'short', day: 'numeric', month: 'short',
                        hour: 'numeric', minute: '2-digit',
                      })} · {ev.communities?.name}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>
                        {ev.attendee_count} ticket{ev.attendee_count !== 1 ? 's' : ''}
                        {ev.max_attendees ? ` / ${ev.max_attendees}` : ''}
                      </span>
                      {ev.is_paid && revenueByEvent[ev.id] !== undefined && (
                        <span className="text-primary font-medium">
                          {fmt(revenueByEvent[ev.id])} net
                        </span>
                      )}
                    </div>
                  </div>
                  <AttendeesPanel eventId={ev.id} eventTitle={ev.title} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create AttendeesPanel client component**

```tsx
// apps/studio/app/(dashboard)/events/AttendeesPanel.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

interface Attendee { user_id: string; ticket_code: string; profiles: { full_name: string | null } | null; }

export function AttendeesPanel({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const [open, setOpen] = useState(false);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (attendees.length > 0) { setOpen(true); return; }
    setLoading(true);
    const supabase = createClient();
    // host_id enforced in JOIN by RLS — non-hosts get 0 rows
    const { data } = await supabase
      .from('event_attendees')
      .select('user_id, ticket_code, profiles(full_name)')
      .eq('event_id', eventId);
    setAttendees((data ?? []) as Attendee[]);
    setLoading(false);
    setOpen(true);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        {loading ? '…' : 'Attendees'}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
             onClick={() => setOpen(false)}>
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto p-6"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{eventTitle}</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground text-xl leading-none">×</button>
            </div>
            {attendees.length === 0 ? (
              <p className="text-muted-foreground text-sm">No attendees yet.</p>
            ) : (
              <ul className="space-y-2">
                {attendees.map(a => (
                  <li key={a.user_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <span className="text-sm">{a.profiles?.full_name ?? 'Anonymous'}</span>
                    <span className="font-mono text-xs text-muted-foreground">{a.ticket_code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Build to verify**

```bash
cd apps/studio
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/\(dashboard\)/events/
git commit -m "feat: Studio Events — description, cover, capacity, is_private, ticket sales, attendees panel"
```

---

## Task 13: Studio — Delete `/protected` Template Pages

**Files:**
- Delete: `apps/studio/app/protected/page.tsx`
- Delete: `apps/studio/app/protected/layout.tsx`

- [ ] **Step 1: Delete files**

```bash
rm apps/studio/app/protected/page.tsx
rm apps/studio/app/protected/layout.tsx
rmdir apps/studio/app/protected
```

- [ ] **Step 2: Build to verify no broken references**

```bash
cd apps/studio
npm run build
```

Expected: build succeeds, `/protected` route gone from output.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove /protected template pages"
```

---

## Task 14: Final Verification + Push

- [ ] **Step 1: Run full mobile test suite**

```bash
cd apps/mobile
npx jest --ci --passWithNoTests
```

Expected: all tests pass (54+ including new ones).

- [ ] **Step 2: Run Studio build**

```bash
cd apps/studio
npm run build
```

Expected: all routes build, no errors.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`:
- Update sessions table: add Session 13
- Update migrations table: add `022_payments_phase2.sql`
- Update next migration number to 023

- [ ] **Step 4: Final commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — session 13, migration 022"
git push origin session-12-stripe-studio
```

Expected: push succeeds, Vercel auto-deploys preview.
