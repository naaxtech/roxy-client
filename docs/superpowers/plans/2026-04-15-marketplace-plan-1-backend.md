# Roxy Marketplace — Plan 1: Backend (Migrations + Edge Functions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all database migrations and edge functions for the Roxy marketplace — physical goods, per-business cart, Stripe destination charges, order-only-on-payment model.

**Architecture:** Four migrations establish the schema (031–034). Nine edge functions handle checkout, webhooks, onboarding, fulfillment, email, and reconciliation. Stripe is the ledger — our DB mirrors its state. An order in our DB = always paid, created only on `payment_intent.succeeded` webhook.

**Tech Stack:** Supabase (Postgres, Edge Functions, pg_cron, pg_net), Deno, TypeScript, Stripe Node SDK (`npm:stripe@14`), Resend API.

**Spec:** `docs/superpowers/specs/2026-04-15-marketplace-design.md`

**Plan 2** (Studio) and **Plan 3** (Mobile) depend on this plan completing first.

---

## File Map

```
supabase/migrations/
  031_marketplace_products.sql       CREATE products, product_variants, product_photos
                                     ALTER businesses, ALTER profiles
  032_marketplace_orders.sql         CREATE orders, order_items, order_events,
                                     refunds, disputes, seller_payouts
  033_marketplace_carts.sql          CREATE carts, cart_items
  034_marketplace_infra.sql          CREATE webhook_events, email_queue,
                                     email_delivery_events, marketplace_settings,
                                     reconciliation_alerts, pg_cron jobs

supabase/functions/
  create-product-order/index.ts      Validate cart → reserve stock → create PaymentIntent
  stripe-product-webhook/index.ts    Handle all marketplace Stripe events
  connect-business-stripe/index.ts   Business Stripe Express onboarding
  staff-approve-product/index.ts     Staff approve/reject products
  update-order-shipped/index.ts      Business marks order shipped + tracking
  refund-order/index.ts              Initiate Stripe refund via charge ID
  get-orders-buyer/index.ts          Buyer order history
  get-orders-business/index.ts       Business order list
  process-email-queue/index.ts       Outbox processor — retry + Resend API
  resend-webhook/index.ts            Delivery event tracking
  reconcile-orders/index.ts          Daily drift detection vs Stripe
```

---

## Task 1: Migration 031 — Products schema

**Files:**
- Create: `supabase/migrations/031_marketplace_products.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/031_marketplace_products.sql

-- businesses additions
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS currency             text        NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS stripe_account_id    text,
  ADD COLUMN IF NOT EXISTS stripe_onboarded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS can_sell             boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_schedule_set  boolean     NOT NULL DEFAULT false;

-- profiles additions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS last_shipping_address  jsonb;

-- products
CREATE TABLE public.products (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description       text        CHECK (length(description) <= 2000),
  base_price_cents  integer     NOT NULL CHECK (base_price_cents > 0),
  category          text        NOT NULL CHECK (category IN (
                                  'apparel','accessories','beauty',
                                  'art','food','books','other'
                                )),
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','rejected','archived')),
  is_active         boolean     NOT NULL DEFAULT true,
  has_variants      boolean     NOT NULL DEFAULT false,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- product_variants
CREATE TABLE public.product_variants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku            text,
  option1_name   text,
  option1_value  text,
  option2_name   text,
  option2_value  text,
  price_cents    integer     NOT NULL CHECK (price_cents > 0),
  stock          integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, option1_value, option2_value)
);

-- product_photos
CREATE TABLE public.product_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  alt_text    text,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_photos   ENABLE ROW LEVEL SECURITY;

-- products: approved visible to all; owner sees all statuses
CREATE POLICY "products_select_approved" ON public.products
  FOR SELECT TO authenticated
  USING (
    (status = 'approved' AND is_active = true)
    OR business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "products_insert" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_update" ON public.products
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_delete" ON public.products
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- variants: readable if product is readable
CREATE POLICY "variants_select" ON public.product_variants
  FOR SELECT TO authenticated USING (
    product_id IN (SELECT id FROM public.products WHERE
      (status = 'approved' AND is_active = true)
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "variants_write" ON public.product_variants
  FOR ALL TO authenticated
  USING (
    product_id IN (
      SELECT p.id FROM public.products p
      JOIN public.businesses b ON b.id = p.business_id
      WHERE b.owner_id = auth.uid()
    )
  );

-- photos: same as variants
CREATE POLICY "photos_select" ON public.product_photos
  FOR SELECT TO authenticated USING (
    product_id IN (SELECT id FROM public.products WHERE
      (status = 'approved' AND is_active = true)
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "photos_write" ON public.product_photos
  FOR ALL TO authenticated
  USING (
    product_id IN (
      SELECT p.id FROM public.products p
      JOIN public.businesses b ON b.id = p.business_id
      WHERE b.owner_id = auth.uid()
    )
  );

-- updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- max 5 photos per product
CREATE OR REPLACE FUNCTION public.check_product_photo_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.product_photos WHERE product_id = NEW.product_id) >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 photos per product';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_product_photo_limit
  BEFORE INSERT ON public.product_photos
  FOR EACH ROW EXECUTE FUNCTION public.check_product_photo_limit();

-- indexes
CREATE INDEX idx_products_business   ON public.products(business_id);
CREATE INDEX idx_products_browsable  ON public.products(business_id, is_active)
                                     WHERE status = 'approved';
CREATE INDEX idx_variants_product    ON public.product_variants(product_id);
```

- [ ] **Step 2: Apply migration locally**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: migration applied, no errors.

- [ ] **Step 3: Verify schema**

```bash
npx supabase db diff
```

Expected: clean diff (no pending changes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/031_marketplace_products.sql
git commit -m "feat(db): migration 031 — products, variants, photos, businesses/profiles additions"
```

---

## Task 2: Migration 032 — Orders schema

**Files:**
- Create: `supabase/migrations/032_marketplace_orders.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/032_marketplace_orders.sql

CREATE TABLE public.orders (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id                  uuid        NOT NULL REFERENCES public.profiles(id),
  business_id               uuid        NOT NULL REFERENCES public.businesses(id),
  status                    text        NOT NULL DEFAULT 'paid'
                                        CHECK (status IN (
                                          'paid','shipped','delivered','refunded','cancelled'
                                        )),
  -- shipping address flat columns
  shipping_name             text        NOT NULL,
  shipping_line1            text        NOT NULL,
  shipping_line2            text,
  shipping_city             text        NOT NULL,
  shipping_state            text        NOT NULL,
  shipping_postal_code      text        NOT NULL,
  shipping_country          text        NOT NULL DEFAULT 'US',
  -- financials — populated from Stripe webhook, never client-computed
  currency                  text        NOT NULL DEFAULT 'usd',
  subtotal_cents            integer     NOT NULL CHECK (subtotal_cents > 0),
  shipping_cost_cents       integer     NOT NULL DEFAULT 0,
  tax_cents                 integer     NOT NULL DEFAULT 0,
  platform_fee_cents        integer     NOT NULL,
  total_cents               integer     GENERATED ALWAYS AS
                                          (subtotal_cents + shipping_cost_cents + tax_cents) STORED,
  -- stripe references
  stripe_payment_intent_id  text        UNIQUE NOT NULL,
  stripe_charge_id          text        UNIQUE,
  stripe_transfer_id        text        UNIQUE,
  stripe_invoice_id         text        UNIQUE,
  stripe_invoice_url        text,
  risk_level                text        CHECK (risk_level IN ('normal','elevated','highest')),
  -- fulfillment
  tracking_number           text,
  shipped_at                timestamptz,
  delivered_at              timestamptz,
  cancelled_at              timestamptz,
  cancellation_reason       text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id        uuid        REFERENCES public.products(id),
  variant_id        uuid        REFERENCES public.product_variants(id),
  product_name      text        NOT NULL,
  variant_label     text,
  unit_price_cents  integer     NOT NULL,
  quantity          integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total_cents  integer     GENERATED ALWAYS AS (unit_price_cents * quantity) STORED,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event       text        NOT NULL CHECK (event IN (
                            'payment_confirmed','shipped','delivered',
                            'cancelled','refunded','note_added'
                          )),
  note        text,
  metadata    jsonb,
  actor_type  text        NOT NULL CHECK (actor_type IN ('buyer','business','staff','system')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.refunds (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid        NOT NULL REFERENCES public.orders(id),
  amount_cents      integer     NOT NULL CHECK (amount_cents > 0),
  reason            text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','succeeded','failed')),
  stripe_refund_id  text        UNIQUE NOT NULL,
  initiated_by      text        NOT NULL CHECK (initiated_by IN ('buyer','business','staff')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.disputes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid        NOT NULL REFERENCES public.orders(id),
  stripe_dispute_id     text        UNIQUE NOT NULL,
  amount_cents          integer     NOT NULL,
  reason                text,
  status                text        NOT NULL CHECK (status IN (
                                      'warning_needs_response','warning_under_review',
                                      'warning_closed','needs_response','under_review',
                                      'charge_refunded','won','lost'
                                    )),
  evidence_submitted_at timestamptz,
  response_due_by       timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_payouts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id),
  stripe_payout_id  text        UNIQUE NOT NULL,
  amount_cents      integer     NOT NULL,
  currency          text        NOT NULL DEFAULT 'usd',
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','paid','failed','cancelled')),
  failure_message   text,
  arrival_date      date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

-- orders: buyer or business owner
CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- orders UPDATE: business owner only (for shipped/tracking)
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- order_items / order_events: via order ownership
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM public.orders WHERE
      buyer_id = auth.uid()
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  ));

CREATE POLICY "order_events_select" ON public.order_events FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM public.orders WHERE
      buyer_id = auth.uid()
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  ));

-- refunds / disputes: via order ownership
CREATE POLICY "refunds_select" ON public.refunds FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM public.orders WHERE
      buyer_id = auth.uid()
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  ));

CREATE POLICY "disputes_select" ON public.disputes FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM public.orders WHERE
      buyer_id = auth.uid()
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  ));

-- seller_payouts: business owner only
CREATE POLICY "seller_payouts_select" ON public.seller_payouts FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- triggers
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- refund ceiling: cannot refund more than order subtotal
CREATE OR REPLACE FUNCTION public.check_refund_ceiling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total_refunded integer;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO total_refunded
    FROM public.refunds
    WHERE order_id = NEW.order_id AND status != 'failed';
  IF total_refunded + NEW.amount_cents >
     (SELECT subtotal_cents FROM public.orders WHERE id = NEW.order_id) THEN
    RAISE EXCEPTION 'Refund amount exceeds order subtotal';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_refund_ceiling
  BEFORE INSERT ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.check_refund_ceiling();

-- indexes
CREATE INDEX idx_orders_buyer      ON public.orders(buyer_id);
CREATE INDEX idx_orders_business   ON public.orders(business_id);
CREATE INDEX idx_orders_stripe_pi  ON public.orders(stripe_payment_intent_id);
CREATE INDEX idx_orders_status     ON public.orders(status);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_events_order ON public.order_events(order_id);
CREATE INDEX idx_refunds_order     ON public.refunds(order_id);
CREATE INDEX idx_disputes_order    ON public.disputes(order_id);
CREATE INDEX idx_payouts_business  ON public.seller_payouts(business_id);
CREATE INDEX idx_payouts_status    ON public.seller_payouts(status);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db push && npx supabase db diff
```

Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/032_marketplace_orders.sql
git commit -m "feat(db): migration 032 — orders, order_items, order_events, refunds, disputes, payouts"
```

---

## Task 3: Migration 033 — Carts

**Files:**
- Create: `supabase/migrations/033_marketplace_carts.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/033_marketplace_carts.sql

CREATE TABLE public.carts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id     uuid        NOT NULL REFERENCES public.profiles(id),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, business_id)
);

CREATE TABLE public.cart_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid        NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES public.products(id),
  variant_id  uuid        REFERENCES public.product_variants(id),
  quantity    integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id, variant_id)
);

ALTER TABLE public.carts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts_owner" ON public.carts
  FOR ALL TO authenticated USING (buyer_id = auth.uid());

CREATE POLICY "cart_items_owner" ON public.cart_items
  FOR ALL TO authenticated
  USING (cart_id IN (SELECT id FROM public.carts WHERE buyer_id = auth.uid()));

CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_cart_items_cart ON public.cart_items(cart_id);
CREATE INDEX idx_carts_buyer_biz ON public.carts(buyer_id, business_id);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db push && npx supabase db diff
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/033_marketplace_carts.sql
git commit -m "feat(db): migration 033 — carts + cart_items with TTL"
```

---

## Task 4: Migration 034 — Infrastructure (webhook events, email queue, settings, cron)

**Files:**
- Create: `supabase/migrations/034_marketplace_infra.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/034_marketplace_infra.sql

-- webhook idempotency + audit
CREATE TABLE public.webhook_events (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id           text        UNIQUE NOT NULL,
  event_type                text        NOT NULL,
  stripe_payment_intent_id  text,
  amount_cents              integer,
  failure_reason            text,
  status                    text        NOT NULL DEFAULT 'processed'
                                        CHECK (status IN ('processed','failed')),
  processed_at              timestamptz NOT NULL DEFAULT now()
);

-- email outbox
CREATE TABLE public.email_queue (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type        text        NOT NULL CHECK (email_type IN (
                                  'order_shipped_buyer',
                                  'product_approved',
                                  'product_rejected',
                                  'refund_notification_buyer',
                                  'dispute_alert_business'
                                )),
  recipient_type    text        NOT NULL CHECK (recipient_type IN ('buyer','business')),
  recipient_user_id uuid        NOT NULL REFERENCES public.profiles(id),
  order_id          uuid        REFERENCES public.orders(id),
  product_id        uuid        REFERENCES public.products(id),
  payload           jsonb       NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                  'pending','processing','sent','failed','dead_letter'
                                )),
  retry_count       integer     NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at     timestamptz NOT NULL DEFAULT now(),
  processing_since  timestamptz,
  last_error        text,
  sent_at           timestamptz,
  resend_message_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (order_id,   email_type, recipient_user_id),
  UNIQUE NULLS NOT DISTINCT (product_id, email_type, recipient_user_id)
);

-- email delivery tracking
CREATE TABLE public.email_delivery_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_queue_id    uuid        NOT NULL REFERENCES public.email_queue(id),
  resend_message_id text        NOT NULL,
  event_type        text        NOT NULL CHECK (event_type IN (
                                  'delivered','bounced','complained','opened','clicked'
                                )),
  raw_payload       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- marketplace settings (single row)
CREATE TABLE public.marketplace_settings (
  id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_fee_percent       numeric(5,2) NOT NULL DEFAULT 10.00
                                          CHECK (product_fee_percent >= 0
                                                 AND product_fee_percent <= 100),
  min_product_price_cents   integer      NOT NULL DEFAULT 100,
  max_product_photos        integer      NOT NULL DEFAULT 5,
  cart_ttl_days             integer      NOT NULL DEFAULT 7,
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO public.marketplace_settings DEFAULT VALUES;

-- reconciliation alerts
CREATE TABLE public.reconciliation_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type    text        NOT NULL CHECK (alert_type IN (
                              'charge_not_in_db',
                              'order_paid_no_charge',
                              'refund_mismatch',
                              'payout_mismatch',
                              'transfer_missing'
                            )),
  stripe_id     text,
  order_id      uuid        REFERENCES public.orders(id),
  detail        text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS: all infra tables service-role only
ALTER TABLE public.webhook_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_queue             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_alerts   ENABLE ROW LEVEL SECURITY;
-- No policies = only service role can access (RLS enabled, no authenticated policies)

-- indexes
CREATE INDEX idx_email_queue_processable   ON public.email_queue(next_retry_at)
                                           WHERE status IN ('pending','failed');
CREATE INDEX idx_email_queue_stuck         ON public.email_queue(processing_since)
                                           WHERE status = 'processing';
CREATE INDEX idx_webhook_stripe_event      ON public.webhook_events(stripe_event_id);
CREATE INDEX idx_webhook_event_type        ON public.webhook_events(event_type);
CREATE INDEX idx_recon_unresolved          ON public.reconciliation_alerts(created_at)
                                           WHERE resolved_at IS NULL;
CREATE INDEX idx_email_delivery_queue      ON public.email_delivery_events(email_queue_id);

-- pg_cron jobs (requires pg_cron extension enabled in Supabase project)
SELECT cron.schedule(
  'process-email-queue',
  '* * * * *',
  format(
    $$SELECT net.http_post(url:='%s/process-email-queue',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,
      body:='{}'::jsonb)$$,
    current_setting('app.edge_base_url'),
    current_setting('app.service_role_key')
  )
);

SELECT cron.schedule(
  'daily-reconciliation',
  '0 2 * * *',
  format(
    $$SELECT net.http_post(url:='%s/reconcile-orders',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,
      body:='{}'::jsonb)$$,
    current_setting('app.edge_base_url'),
    current_setting('app.service_role_key')
  )
);

SELECT cron.schedule(
  'purge-expired-carts',
  '0 3 * * *',
  $$DELETE FROM public.carts WHERE expires_at < now()$$
);

SELECT cron.schedule(
  'cleanup-email-queue',
  '0 4 * * *',
  $$DELETE FROM public.email_queue WHERE status = 'sent' AND created_at < now() - interval '90 days'$$
);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db push && npx supabase db diff
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/034_marketplace_infra.sql
git commit -m "feat(db): migration 034 — webhook_events, email_queue, marketplace_settings, reconciliation, cron"
```

---

## Task 5: Edge function — `create-product-order`

**Files:**
- Create: `supabase/functions/create-product-order/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/create-product-order/index.ts
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

  let body: {
    cart_id: string;
    shipping_address: {
      name: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
    idempotency_key: string;
    shipping_cost_cents?: number;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { cart_id, shipping_address, idempotency_key, shipping_cost_cents = 0 } = body;

  if (!cart_id || !shipping_address || !idempotency_key) {
    return errorResponse('Missing required fields: cart_id, shipping_address, idempotency_key', 400);
  }

  if (DEV_MOCK) {
    return successResponse({ client_secret: 'pi_mock_secret_test', order_id: 'mock-order-id' });
  }

  const supabase = getSupabaseClient();
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20' as any });

  // 1. Load cart + items + products + variants
  const { data: cart, error: cartErr } = await supabase
    .from('carts')
    .select(`
      id, buyer_id, business_id, expires_at,
      cart_items (
        id, quantity,
        product:products ( id, name, status, is_active, has_variants, base_price_cents, business_id ),
        variant:product_variants ( id, price_cents, stock, is_active, option1_name, option1_value, option2_name, option2_value )
      ),
      business:businesses ( id, stripe_account_id, can_sell, payout_schedule_set, currency )
    `)
    .eq('id', cart_id)
    .eq('buyer_id', userId)
    .maybeSingle();

  if (cartErr || !cart) return errorResponse('Cart not found', 404);
  if (new Date(cart.expires_at) < new Date()) return errorResponse('Cart has expired', 400);
  if (!cart.cart_items || cart.cart_items.length === 0) return errorResponse('Cart is empty', 400);

  const business = cart.business as any;
  if (!business.can_sell) return errorResponse('Business is not approved to sell', 403);
  if (!business.stripe_account_id) return errorResponse('Business has no Stripe account', 403);
  if (!business.payout_schedule_set) return errorResponse('Business payout schedule not configured', 403);

  // 2. Validate all products
  for (const item of cart.cart_items as any[]) {
    const product = item.product;
    if (!product) return errorResponse(`Product not found for cart item ${item.id}`, 400);
    if (product.status !== 'approved') return errorResponse(`Product "${product.name}" is not approved`, 400);
    if (!product.is_active) return errorResponse(`Product "${product.name}" is not active`, 400);
    if (product.has_variants && !item.variant) return errorResponse(`Variant required for "${product.name}"`, 400);
    if (item.variant && !item.variant.is_active) return errorResponse(`Selected variant is not available`, 400);
  }

  // 3. Atomic stock decrement (FOR UPDATE)
  const stockUpdates: Array<{ variantId: string; qty: number }> = [];
  for (const item of cart.cart_items as any[]) {
    if (!item.variant) continue;
    const { data: updated, error: stockErr } = await supabase.rpc('decrement_variant_stock', {
      p_variant_id: item.variant.id,
      p_qty: item.quantity,
    });
    if (stockErr || !updated) {
      // Rollback already decremented stock
      for (const prev of stockUpdates) {
        await supabase.rpc('increment_variant_stock', { p_variant_id: prev.variantId, p_qty: prev.qty });
      }
      return errorResponse(`"${item.product.name}" is out of stock`, 409);
    }
    stockUpdates.push({ variantId: item.variant.id, qty: item.quantity });
  }

  // 4. Ensure Stripe Customer for buyer
  let stripeCustomerId = (
    await supabase.from('profiles').select('stripe_customer_id').eq('id', userId).single()
  ).data?.stripe_customer_id;

  if (!stripeCustomerId) {
    // Get buyer email from auth.users
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    const customer = await stripe.customers.create({
      email: user?.email,
      metadata: { roxy_user_id: userId },
    });
    stripeCustomerId = customer.id;
    await supabase.from('profiles').update({ stripe_customer_id: stripeCustomerId }).eq('id', userId);
  }

  // 5. Calculate totals
  const items = cart.cart_items as any[];
  const subtotalCents = items.reduce((sum: number, item: any) => {
    const price = item.variant ? item.variant.price_cents : item.product.base_price_cents;
    return sum + price * item.quantity;
  }, 0);

  const { data: settings } = await supabase.from('marketplace_settings').select('product_fee_percent').single();
  const feePercent = Number(settings?.product_fee_percent ?? 10);
  const platformFeeCents = Math.floor(subtotalCents * (feePercent / 100));
  const totalCents = subtotalCents + shipping_cost_cents;

  // 6. Build items metadata for webhook (price snapshots)
  const itemsMeta = items.map((item: any) => ({
    product_id: item.product.id,
    variant_id: item.variant?.id ?? null,
    product_name: item.product.name,
    variant_label: item.variant
      ? [item.variant.option1_value, item.variant.option2_value].filter(Boolean).join(' / ')
      : null,
    unit_price_cents: item.variant ? item.variant.price_cents : item.product.base_price_cents,
    quantity: item.quantity,
  }));

  // 7. Create PaymentIntent
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: business.currency ?? 'usd',
        customer: stripeCustomerId,
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: business.stripe_account_id },
        on_behalf_of: business.stripe_account_id,
        automatic_payment_methods: { enabled: true },
        metadata: {
          buyer_id: userId,
          business_id: business.id,
          cart_id: cart_id,
          idempotency_key,
          items_json: JSON.stringify(itemsMeta),
          subtotal_cents: String(subtotalCents),
          shipping_cost_cents: String(shipping_cost_cents),
          platform_fee_cents: String(platformFeeCents),
          shipping_name: shipping_address.name,
          shipping_line1: shipping_address.line1,
          shipping_line2: shipping_address.line2 ?? '',
          shipping_city: shipping_address.city,
          shipping_state: shipping_address.state,
          shipping_postal_code: shipping_address.postal_code,
          shipping_country: shipping_address.country,
        },
      },
      { idempotencyKey: idempotency_key }
    );
  } catch (err) {
    // Rollback all stock decrements on Stripe failure
    for (const s of stockUpdates) {
      await supabase.rpc('increment_variant_stock', { p_variant_id: s.variantId, p_qty: s.qty });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Stripe error: ${msg}`, 500);
  }

  return successResponse({ client_secret: paymentIntent.client_secret });
});
```

- [ ] **Step 2: Add the stock RPC functions to a migration (needed by Task 5)**

Add to `supabase/migrations/031_marketplace_products.sql` (or create a small patch migration if 031 is already applied):

```sql
-- Stock decrement — returns true if successful, false if insufficient stock
CREATE OR REPLACE FUNCTION public.decrement_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE updated_rows integer;
BEGIN
  UPDATE public.product_variants
    SET stock = stock - p_qty
    WHERE id = p_variant_id AND stock >= p_qty AND is_active = true;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.increment_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.product_variants SET stock = stock + p_qty WHERE id = p_variant_id;
END $$;
```

If 031 is already applied, create `031b_stock_rpc.sql`:

```sql
-- supabase/migrations/031b_stock_rpc.sql
CREATE OR REPLACE FUNCTION public.decrement_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE updated_rows integer;
BEGIN
  UPDATE public.product_variants
    SET stock = stock - p_qty
    WHERE id = p_variant_id AND stock >= p_qty AND is_active = true;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.increment_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.product_variants SET stock = stock + p_qty WHERE id = p_variant_id;
END $$;
```

```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-product-order/
git commit -m "feat(edge): create-product-order — validate cart, reserve stock, create PaymentIntent"
```

---

## Task 6: Edge function — `stripe-product-webhook`

**Files:**
- Create: `supabase/functions/stripe-product-webhook/index.ts`

Note: This is a **separate** Stripe webhook endpoint from the existing `stripe-webhooks` (which handles ticket payments). Register a new webhook endpoint in the Stripe Dashboard pointing to this function's URL with a new signing secret stored as `STRIPE_PRODUCT_WEBHOOK_SECRET`.

- [ ] **Step 1: Write the webhook handler**

```typescript
// supabase/functions/stripe-product-webhook/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_PRODUCT_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return errorResponse('Missing Stripe-Signature', 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    return errorResponse(`Signature verification failed: ${err}`, 400);
  }

  const supabase = getSupabaseClient();

  // Idempotency check
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existing) return successResponse({ received: true, skipped: true });

  // Record event first
  await supabase.from('webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    status: 'processed',
  });

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata;

        // Guard: only handle marketplace payments (have our metadata)
        if (!meta?.buyer_id || !meta?.items_json) break;

        // Idempotency: order may already exist if webhook retried
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('id')
          .eq('stripe_payment_intent_id', pi.id)
          .maybeSingle();
        if (existingOrder) break;

        // Get charge details from Stripe (fresh, not from event payload)
        const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 1 });
        const charge = charges.data[0];
        const transferId = typeof charge?.transfer === 'string' ? charge.transfer : charge?.transfer?.id;

        // Create Stripe invoice for buyer receipt
        let invoiceId: string | null = null;
        let invoiceUrl: string | null = null;
        try {
          const invoice = await stripe.invoices.create({
            customer: pi.customer as string,
            auto_advance: true,
            metadata: { payment_intent_id: pi.id },
          });
          const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
          invoiceId = finalized.id;
          invoiceUrl = finalized.hosted_invoice_url ?? null;
        } catch {
          // Invoice creation failure is non-fatal — order still created
        }

        const items: Array<{
          product_id: string; variant_id: string | null;
          product_name: string; variant_label: string | null;
          unit_price_cents: number; quantity: number;
        }> = JSON.parse(meta.items_json);

        const subtotalCents = Number(meta.subtotal_cents);
        const shippingCents = Number(meta.shipping_cost_cents);
        const platformFeeCents = Number(meta.platform_fee_cents);
        const taxCents = charge?.tax ?? 0;

        // Create order
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            buyer_id: meta.buyer_id,
            business_id: meta.business_id,
            status: 'paid',
            shipping_name: meta.shipping_name,
            shipping_line1: meta.shipping_line1,
            shipping_line2: meta.shipping_line2 || null,
            shipping_city: meta.shipping_city,
            shipping_state: meta.shipping_state,
            shipping_postal_code: meta.shipping_postal_code,
            shipping_country: meta.shipping_country,
            currency: pi.currency,
            subtotal_cents: subtotalCents,
            shipping_cost_cents: shippingCents,
            tax_cents: taxCents,
            platform_fee_cents: platformFeeCents,
            stripe_payment_intent_id: pi.id,
            stripe_charge_id: charge?.id ?? null,
            stripe_transfer_id: transferId ?? null,
            stripe_invoice_id: invoiceId,
            stripe_invoice_url: invoiceUrl,
            risk_level: charge?.outcome?.risk_level ?? 'normal',
          })
          .select('id')
          .single();

        if (orderErr || !order) {
          console.error('Failed to create order:', orderErr);
          break;
        }

        // Create order items
        await supabase.from('order_items').insert(
          items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            product_name: item.product_name,
            variant_label: item.variant_label,
            unit_price_cents: item.unit_price_cents,
            quantity: item.quantity,
          }))
        );

        // Order event
        await supabase.from('order_events').insert({
          order_id: order.id,
          event: 'payment_confirmed',
          actor_type: 'system',
          metadata: { stripe_charge_id: charge?.id },
        });

        // Clear cart
        await supabase.from('cart_items').delete().eq('cart_id', meta.cart_id);

        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata;
        if (!meta?.buyer_id || !meta?.items_json) break;

        // Release stock
        const items: Array<{ variant_id: string | null; quantity: number }> =
          JSON.parse(meta.items_json);

        for (const item of items) {
          if (!item.variant_id) continue;
          await supabase.rpc('increment_variant_stock', {
            p_variant_id: item.variant_id,
            p_qty: item.quantity,
          });
        }

        // Log failure details (no order created)
        const failureReason = pi.last_payment_error?.message ?? 'Unknown';
        await supabase
          .from('webhook_events')
          .update({ failure_reason: failureReason, amount_cents: pi.amount, stripe_payment_intent_id: pi.id })
          .eq('stripe_event_id', event.id);

        break;
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        // Find business by stripe_account_id (from event.account for Connect events)
        const accountId = (event as any).account;
        if (!accountId) break;

        const { data: business } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_account_id', accountId)
          .maybeSingle();
        if (!business) break;

        await supabase.from('seller_payouts').upsert({
          business_id: business.id,
          stripe_payout_id: payout.id,
          amount_cents: payout.amount,
          currency: payout.currency,
          status: 'paid',
          arrival_date: new Date(payout.arrival_date * 1000).toISOString().split('T')[0],
        }, { onConflict: 'stripe_payout_id' });

        break;
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        const accountId = (event as any).account;
        if (!accountId) break;

        const { data: business } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_account_id', accountId)
          .maybeSingle();
        if (!business) break;

        await supabase.from('seller_payouts').upsert({
          business_id: business.id,
          stripe_payout_id: payout.id,
          amount_cents: payout.amount,
          currency: payout.currency,
          status: 'failed',
          failure_message: payout.failure_message ?? 'Unknown failure',
        }, { onConflict: 'stripe_payout_id' });

        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;

        const { data: order } = await supabase
          .from('orders')
          .select('id, tracking_number, shipping_name, shipping_line1, shipping_city')
          .eq('stripe_charge_id', chargeId)
          .maybeSingle();
        if (!order) break;

        await supabase.from('disputes').insert({
          order_id: order.id,
          stripe_dispute_id: dispute.id,
          amount_cents: dispute.amount,
          reason: dispute.reason,
          status: dispute.status,
          response_due_by: new Date(
            (dispute.evidence_details?.due_by ?? Math.floor(Date.now() / 1000) + 604800) * 1000
          ).toISOString(),
        });

        // Auto-submit evidence
        try {
          const { data: items } = await supabase
            .from('order_items')
            .select('product_name, quantity, unit_price_cents')
            .eq('order_id', order.id);

          const productDesc = items
            ?.map(i => `${i.product_name} x${i.quantity} @ $${(i.unit_price_cents / 100).toFixed(2)}`)
            .join(', ') ?? '';

          await stripe.disputes.update(dispute.id, {
            evidence: {
              product_description: productDesc,
              shipping_address: `${order.shipping_line1}, ${order.shipping_city}`,
              shipping_tracking_number: order.tracking_number ?? undefined,
            },
          });

          await supabase
            .from('disputes')
            .update({ evidence_submitted_at: new Date().toISOString() })
            .eq('stripe_dispute_id', dispute.id);
        } catch {
          // Evidence submission failure is non-fatal
        }

        // Queue business alert email
        const { data: orderFull } = await supabase
          .from('orders')
          .select('business_id, businesses(owner_id)')
          .eq('id', order.id)
          .single();

        if (orderFull) {
          const ownerId = (orderFull.businesses as any)?.owner_id;
          if (ownerId) {
            await supabase.from('email_queue').insert({
              email_type: 'dispute_alert_business',
              recipient_type: 'business',
              recipient_user_id: ownerId,
              order_id: order.id,
              payload: {
                order_short_id: order.id.slice(0, 8).toUpperCase(),
                dispute_amount_cents: dispute.amount,
                response_due_by: new Date(
                  (dispute.evidence_details?.due_by ?? 0) * 1000
                ).toISOString(),
                instructions: 'Log into Roxy Studio to review this dispute.',
              },
            }).onConflict('order_id, email_type, recipient_user_id').ignore();
          }
        }

        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object as Stripe.Dispute;
        await supabase
          .from('disputes')
          .update({ status: dispute.status, updated_at: new Date().toISOString() })
          .eq('stripe_dispute_id', dispute.id);
        break;
      }

      case 'charge.refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        await supabase
          .from('refunds')
          .update({ status: refund.status === 'succeeded' ? 'succeeded' : 'failed' })
          .eq('stripe_refund_id', refund.id);

        if (refund.status === 'succeeded') {
          // Check if fully refunded
          const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
          if (chargeId) {
            const { data: order } = await supabase
              .from('orders')
              .select('id, subtotal_cents')
              .eq('stripe_charge_id', chargeId)
              .maybeSingle();
            if (order) {
              const { data: refunds } = await supabase
                .from('refunds')
                .select('amount_cents')
                .eq('order_id', order.id)
                .eq('status', 'succeeded');
              const totalRefunded = refunds?.reduce((s, r) => s + r.amount_cents, 0) ?? 0;
              if (totalRefunded >= order.subtotal_cents) {
                await supabase
                  .from('orders')
                  .update({ status: 'refunded' })
                  .eq('id', order.id);
              }
            }
          }
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const canSell = account.charges_enabled && account.payouts_enabled;
        await supabase
          .from('businesses')
          .update({
            can_sell: canSell,
            stripe_onboarded_at: canSell ? new Date().toISOString() : null,
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      case 'capability.updated': {
        const cap = event.data.object as Stripe.Capability;
        if (cap.id === 'card_payments') {
          const accountId = typeof cap.account === 'string' ? cap.account : cap.account.id;
          const canSell = cap.status === 'active';
          await supabase
            .from('businesses')
            .update({ can_sell: canSell })
            .eq('stripe_account_id', accountId);
        }
        break;
      }

      case 'review.opened': {
        const review = event.data.object as Stripe.Review;
        const piId = typeof review.payment_intent === 'string'
          ? review.payment_intent
          : review.payment_intent?.id;
        if (!piId) break;

        const { data: order } = await supabase
          .from('orders')
          .select('id')
          .eq('stripe_payment_intent_id', piId)
          .maybeSingle();
        if (!order) break;

        await supabase.from('order_events').insert({
          order_id: order.id,
          event: 'note_added',
          actor_type: 'system',
          note: 'Payment under Stripe fraud review. Do not ship until review is resolved.',
          metadata: { stripe_review_id: review.id },
        });
        break;
      }

      case 'review.closed': {
        const review = event.data.object as Stripe.Review;
        if (review.reason === 'refunded_as_fraud' || review.reason === 'disputed') {
          const piId = typeof review.payment_intent === 'string'
            ? review.payment_intent
            : review.payment_intent?.id;
          if (piId) {
            await supabase
              .from('orders')
              .update({ status: 'cancelled', cancellation_reason: 'Refunded as fraud by Stripe' })
              .eq('stripe_payment_intent_id', piId);
          }
        }
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'transfer_missing',
          stripe_id: transfer.id,
          detail: `Transfer failed: ${JSON.stringify(transfer)}`,
        });
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-product-webhook] handler error for ${event.type}:`, msg);
    await supabase
      .from('webhook_events')
      .update({ status: 'failed' })
      .eq('stripe_event_id', event.id);
  }

  return successResponse({ received: true });
});
```

- [ ] **Step 2: Add env secret**

```bash
npx supabase secrets set STRIPE_PRODUCT_WEBHOOK_SECRET=whsec_your_secret_here --project-ref ptymtdlysqbpxzlgsshp
```

Register new webhook endpoint in Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://<project-ref>.supabase.co/functions/v1/stripe-product-webhook`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.refund.updated`, `account.updated`, `capability.updated`, `payout.paid`, `payout.failed`, `review.opened`, `review.closed`, `transfer.failed`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-product-webhook/
git commit -m "feat(edge): stripe-product-webhook — order creation, stock release, payouts, disputes"
```

---

## Task 7: Edge function — `connect-business-stripe`

**Files:**
- Create: `supabase/functions/connect-business-stripe/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/connect-business-stripe/
git commit -m "feat(edge): connect-business-stripe — Express onboarding + payout schedule + dashboard link"
```

---

## Task 8: Edge functions — `staff-approve-product`, `update-order-shipped`, `refund-order`

**Files:**
- Create: `supabase/functions/staff-approve-product/index.ts`
- Create: `supabase/functions/update-order-shipped/index.ts`
- Create: `supabase/functions/refund-order/index.ts`

- [ ] **Step 1: Write `staff-approve-product`**

```typescript
// supabase/functions/staff-approve-product/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { product_id: string; action: 'approve' | 'reject'; rejection_reason?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { product_id, action, rejection_reason } = body;
  if (!product_id || !action) return errorResponse('Missing product_id or action', 400);

  const supabase = getSupabaseClient();

  // Verify staff
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) return errorResponse('Staff access required', 403);

  if (action === 'approve') {
    await supabase
      .from('products')
      .update({ status: 'approved', rejection_reason: null })
      .eq('id', product_id);

    // Queue approval notification
    const { data: product } = await supabase
      .from('products')
      .select('name, businesses(owner_id, name)')
      .eq('id', product_id)
      .single();

    if (product) {
      const ownerId = (product.businesses as any)?.owner_id;
      if (ownerId) {
        await supabase.from('email_queue').insert({
          email_type: 'product_approved',
          recipient_type: 'business',
          recipient_user_id: ownerId,
          product_id,
          payload: {
            product_name: product.name,
            business_name: (product.businesses as any)?.name ?? '',
          },
        }).onConflict('product_id, email_type, recipient_user_id').ignore();
      }
    }

    return successResponse({ status: 'approved' });
  }

  if (action === 'reject') {
    if (!rejection_reason) return errorResponse('rejection_reason required', 400);
    await supabase
      .from('products')
      .update({ status: 'rejected', rejection_reason })
      .eq('id', product_id);

    const { data: product } = await supabase
      .from('products')
      .select('name, businesses(owner_id)')
      .eq('id', product_id)
      .single();

    if (product) {
      const ownerId = (product.businesses as any)?.owner_id;
      if (ownerId) {
        await supabase.from('email_queue').insert({
          email_type: 'product_rejected',
          recipient_type: 'business',
          recipient_user_id: ownerId,
          product_id,
          payload: { product_name: product.name, rejection_reason },
        }).onConflict('product_id, email_type, recipient_user_id').ignore();
      }
    }

    return successResponse({ status: 'rejected' });
  }

  return errorResponse('Invalid action', 400);
});
```

- [ ] **Step 2: Write `update-order-shipped`**

```typescript
// supabase/functions/update-order-shipped/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { order_id: string; tracking_number: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { order_id, tracking_number } = body;
  if (!order_id || !tracking_number) return errorResponse('Missing order_id or tracking_number', 400);

  const supabase = getSupabaseClient();

  // Verify business ownership
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, business_id, businesses(owner_id), buyer_id')
    .eq('id', order_id)
    .maybeSingle();

  if (!order) return errorResponse('Order not found', 404);
  if ((order.businesses as any)?.owner_id !== userId) return errorResponse('Access denied', 403);
  if (order.status !== 'paid') return errorResponse(`Cannot ship order with status: ${order.status}`, 400);

  await supabase
    .from('orders')
    .update({
      status: 'shipped',
      tracking_number,
      shipped_at: new Date().toISOString(),
    })
    .eq('id', order_id);

  await supabase.from('order_events').insert({
    order_id,
    event: 'shipped',
    actor_type: 'business',
    metadata: { tracking_number },
  });

  // Queue shipping notification email to buyer
  await supabase.from('email_queue').insert({
    email_type: 'order_shipped_buyer',
    recipient_type: 'buyer',
    recipient_user_id: order.buyer_id,
    order_id,
    payload: {
      order_short_id: order_id.slice(0, 8).toUpperCase(),
      business_name: '',
      tracking_number,
      carrier_url: `https://www.google.com/search?q=${encodeURIComponent(tracking_number)}`,
      items_summary: '',
    },
  }).onConflict('order_id, email_type, recipient_user_id').ignore();

  return successResponse({ status: 'shipped', tracking_number });
});
```

- [ ] **Step 3: Write `refund-order`**

```typescript
// supabase/functions/refund-order/index.ts
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

  let body: { order_id: string; amount_cents: number; reason?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { order_id, amount_cents, reason = '' } = body;
  if (!order_id || !amount_cents) return errorResponse('Missing order_id or amount_cents', 400);

  const supabase = getSupabaseClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, stripe_charge_id, buyer_id, business_id, subtotal_cents, businesses(owner_id)')
    .eq('id', order_id)
    .maybeSingle();

  if (!order) return errorResponse('Order not found', 404);

  // Caller must be business owner or staff
  const isBusinessOwner = (order.businesses as any)?.owner_id === userId;
  const { data: profile } = await supabase
    .from('profiles').select('is_staff').eq('id', userId).single();
  const isStaff = profile?.is_staff ?? false;
  if (!isBusinessOwner && !isStaff) return errorResponse('Access denied', 403);

  if (!order.stripe_charge_id) return errorResponse('No charge ID on order — cannot refund', 400);
  if (['refunded', 'cancelled'].includes(order.status)) {
    return errorResponse(`Order is already ${order.status}`, 400);
  }

  if (DEV_MOCK) {
    return successResponse({ refund_id: 're_mock', status: 'pending' });
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20' as any });

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create({
      charge: order.stripe_charge_id,
      amount: amount_cents,
      reason: 'requested_by_customer',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Stripe refund error: ${msg}`, 500);
  }

  await supabase.from('refunds').insert({
    order_id,
    amount_cents,
    reason,
    status: 'pending',
    stripe_refund_id: refund.id,
    initiated_by: isStaff ? 'staff' : 'business',
  });

  await supabase.from('order_events').insert({
    order_id,
    event: 'refunded',
    actor_type: isStaff ? 'staff' : 'business',
    metadata: { amount_cents, stripe_refund_id: refund.id },
  });

  await supabase.from('email_queue').insert({
    email_type: 'refund_notification_buyer',
    recipient_type: 'buyer',
    recipient_user_id: order.buyer_id,
    order_id,
    payload: {
      order_short_id: order_id.slice(0, 8).toUpperCase(),
      amount_cents,
      currency: 'usd',
      reason,
    },
  }).onConflict('order_id, email_type, recipient_user_id').ignore();

  return successResponse({ refund_id: refund.id, status: 'pending' });
});
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/staff-approve-product/ \
        supabase/functions/update-order-shipped/ \
        supabase/functions/refund-order/
git commit -m "feat(edge): staff-approve-product, update-order-shipped, refund-order"
```

---

## Task 9: Edge functions — `get-orders-buyer`, `get-orders-business`

**Files:**
- Create: `supabase/functions/get-orders-buyer/index.ts`
- Create: `supabase/functions/get-orders-business/index.ts`

- [ ] **Step 1: Write `get-orders-buyer`**

```typescript
// supabase/functions/get-orders-buyer/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  const supabase = getSupabaseClient();

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, status, currency, subtotal_cents, shipping_cost_cents, tax_cents,
      total_cents, platform_fee_cents, tracking_number, stripe_invoice_url,
      shipped_at, delivered_at, created_at,
      business:businesses ( id, name, logo_url ),
      order_items (
        id, product_name, variant_label, unit_price_cents, quantity, line_total_cents
      ),
      order_events ( id, event, note, metadata, actor_type, created_at )
    `)
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) return errorResponse(error.message, 500);

  return successResponse({ orders: orders ?? [] });
});
```

- [ ] **Step 2: Write `get-orders-business`**

```typescript
// supabase/functions/get-orders-business/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  const url = new URL(req.url);
  const businessId = url.searchParams.get('business_id');
  const status = url.searchParams.get('status');
  if (!businessId) return errorResponse('Missing business_id', 400);

  const supabase = getSupabaseClient();

  // Verify ownership
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (!biz) return errorResponse('Access denied', 403);

  let query = supabase
    .from('orders')
    .select(`
      id, status, currency, subtotal_cents, shipping_cost_cents, tax_cents,
      total_cents, platform_fee_cents, tracking_number,
      shipping_name, shipping_line1, shipping_line2,
      shipping_city, shipping_state, shipping_postal_code, shipping_country,
      shipped_at, delivered_at, cancelled_at, created_at,
      order_items (
        id, product_name, variant_label, unit_price_cents, quantity, line_total_cents
      ),
      order_events ( id, event, note, metadata, actor_type, created_at )
    `)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: orders, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return successResponse({ orders: orders ?? [] });
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/get-orders-buyer/ supabase/functions/get-orders-business/
git commit -m "feat(edge): get-orders-buyer + get-orders-business"
```

---

## Task 10: Edge function — `process-email-queue`

**Files:**
- Create: `supabase/functions/process-email-queue/index.ts`

- [ ] **Step 1: Write the email outbox processor**

```typescript
// supabase/functions/process-email-queue/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Roxy <noreply@getroxy.app>';

function backoffMinutes(retryCount: number): number {
  const schedule = [0, 2, 10, 60, 360];
  return schedule[Math.min(retryCount, schedule.length - 1)];
}

async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.id as string;
}

function renderTemplate(emailType: string, payload: Record<string, unknown>): { subject: string; html: string } {
  switch (emailType) {
    case 'order_shipped_buyer':
      return {
        subject: `Your order #${payload.order_short_id} has shipped!`,
        html: `<h2>Your order has shipped</h2>
               <p>Tracking: <a href="${payload.carrier_url}">${payload.tracking_number}</a></p>
               <p>${payload.items_summary}</p>`,
      };
    case 'product_approved':
      return {
        subject: `Your product "${payload.product_name}" has been approved`,
        html: `<h2>Product Approved!</h2>
               <p>"${payload.product_name}" is now live on Roxy.</p>`,
      };
    case 'product_rejected':
      return {
        subject: `Update on your product "${payload.product_name}"`,
        html: `<h2>Product Not Approved</h2>
               <p>Reason: ${payload.rejection_reason}</p>
               <p>You can edit and resubmit from Roxy Studio.</p>`,
      };
    case 'refund_notification_buyer':
      return {
        subject: `Refund processed for order #${payload.order_short_id}`,
        html: `<h2>Refund Processed</h2>
               <p>$${((payload.amount_cents as number) / 100).toFixed(2)} has been refunded for order #${payload.order_short_id}.</p>`,
      };
    case 'dispute_alert_business':
      return {
        subject: `Action required: Dispute on order #${payload.order_short_id}`,
        html: `<h2>Dispute Alert</h2>
               <p>A dispute has been opened for order #${payload.order_short_id}.</p>
               <p>Response due: ${payload.response_due_by}</p>
               <p><a href="https://roxy-studio.vercel.app/orders">View in Studio</a></p>`,
      };
    default:
      throw new Error(`Unknown email type: ${emailType}`);
  }
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Require Authorization header with service role key
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!RESEND_API_KEY) return errorResponse('RESEND_API_KEY not set', 500);

  const supabase = getSupabaseClient();

  // Step 1: Reset stuck rows (processing > 5 min)
  await supabase
    .from('email_queue')
    .update({
      status: 'failed',
      last_error: 'Processing timeout — reset by cron',
      processing_since: null,
    })
    .eq('status', 'processing')
    .lt('processing_since', new Date(Date.now() - 5 * 60 * 1000).toISOString());

  // Step 2: Claim batch with FOR UPDATE SKIP LOCKED via RPC
  const { data: rows, error: claimErr } = await supabase.rpc('claim_email_queue_batch', { p_limit: 10 });
  if (claimErr) return errorResponse(`Claim error: ${claimErr.message}`, 500);
  if (!rows || rows.length === 0) return successResponse({ processed: 0 });

  let processed = 0;
  for (const row of rows) {
    try {
      // Get recipient email from auth.users
      const { data: { user }, error: userErr } =
        await supabase.auth.admin.getUserById(row.recipient_user_id);
      if (userErr || !user?.email) throw new Error('Recipient email not found');

      const { subject, html } = renderTemplate(row.email_type, row.payload);
      const messageId = await sendEmail(user.email, subject, html);

      await supabase
        .from('email_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          resend_message_id: messageId,
          processing_since: null,
        })
        .eq('id', row.id);

      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newRetryCount = (row.retry_count ?? 0) + 1;
      const isDeadLetter = newRetryCount >= 5;
      const nextRetry = new Date(
        Date.now() + backoffMinutes(newRetryCount) * 60 * 1000
      ).toISOString();

      await supabase
        .from('email_queue')
        .update({
          status: isDeadLetter ? 'dead_letter' : 'failed',
          retry_count: newRetryCount,
          next_retry_at: nextRetry,
          last_error: errMsg.slice(0, 500), // cap length, no PII
          processing_since: null,
        })
        .eq('id', row.id);
    }
  }

  return successResponse({ processed });
});
```

- [ ] **Step 2: Add the `claim_email_queue_batch` RPC function to a migration**

Create `supabase/migrations/034b_email_queue_rpc.sql`:

```sql
-- supabase/migrations/034b_email_queue_rpc.sql
CREATE OR REPLACE FUNCTION public.claim_email_queue_batch(p_limit integer DEFAULT 10)
RETURNS SETOF public.email_queue LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    UPDATE public.email_queue
    SET status = 'processing', processing_since = now()
    WHERE id IN (
      SELECT id FROM public.email_queue
      WHERE status IN ('pending','failed')
        AND next_retry_at <= now()
      ORDER BY next_retry_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END $$;
```

```bash
npx supabase db push
```

- [ ] **Step 3: Add env secret**

```bash
npx supabase secrets set RESEND_API_KEY=re_your_key_here --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-email-queue/ supabase/migrations/034b_email_queue_rpc.sql
git commit -m "feat(edge): process-email-queue — outbox processor with retry, dead letter, Resend"
```

---

## Task 11: Edge functions — `resend-webhook`, `reconcile-orders`

**Files:**
- Create: `supabase/functions/resend-webhook/index.ts`
- Create: `supabase/functions/reconcile-orders/index.ts`

- [ ] **Step 1: Write `resend-webhook`**

```typescript
// supabase/functions/resend-webhook/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Verify Svix signature (Resend uses Svix for webhook delivery)
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return errorResponse('Missing Svix headers', 400);
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!webhookSecret) return errorResponse('RESEND_WEBHOOK_SECRET not set', 500);

  const body = await req.text();

  // Verify signature using Svix algorithm
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes = Uint8Array.from(
    atob(webhookSecret.replace('whsec_', '')),
    c => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  const signatures = svixSignature.split(' ').map(s => s.replace('v1,', ''));
  if (!signatures.includes(expectedSig)) {
    return errorResponse('Invalid signature', 400);
  }

  let payload: { type: string; data: { email_id: string; [key: string]: unknown } };
  try { payload = JSON.parse(body); } catch { return errorResponse('Invalid JSON', 400); }

  const supabase = getSupabaseClient();

  // Find email_queue row by resend_message_id
  const { data: queueRow } = await supabase
    .from('email_queue')
    .select('id')
    .eq('resend_message_id', payload.data.email_id)
    .maybeSingle();

  if (!queueRow) return successResponse({ received: true, skipped: true });

  const eventType = payload.type.replace('email.', ''); // 'delivered', 'bounced', etc.
  const validTypes = ['delivered', 'bounced', 'complained', 'opened', 'clicked'];
  if (!validTypes.includes(eventType)) return successResponse({ received: true, unknown_type: true });

  // Strip PII from raw payload before storing
  const safePayload = {
    type: payload.type,
    email_id: payload.data.email_id,
    created_at: (payload.data as any).created_at,
  };

  await supabase.from('email_delivery_events').insert({
    email_queue_id: queueRow.id,
    resend_message_id: payload.data.email_id,
    event_type: eventType,
    raw_payload: safePayload,
  });

  // Flag bounces/complaints for staff
  if (eventType === 'bounced' || eventType === 'complained') {
    await supabase
      .from('email_queue')
      .update({ last_error: `Email ${eventType} — check recipient address` })
      .eq('id', queueRow.id);
  }

  return successResponse({ received: true });
});
```

- [ ] **Step 2: Write `reconcile-orders`**

```typescript
// supabase/functions/reconcile-orders/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
    return errorResponse('Unauthorized', 401);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20' as any });

  const supabase = getSupabaseClient();
  const alerts: string[] = [];

  // Window: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(yesterday);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday);
  dayEnd.setHours(23, 59, 59, 999);

  try {
    // 1. Fetch Stripe charges for yesterday
    const charges = await stripe.charges.list({
      created: {
        gte: Math.floor(dayStart.getTime() / 1000),
        lte: Math.floor(dayEnd.getTime() / 1000),
      },
      limit: 100,
    });

    for (const charge of charges.data) {
      if (!charge.payment_intent) continue;
      const piId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent.id;

      // Only check marketplace payments (have buyer_id metadata)
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (!pi.metadata?.buyer_id) continue;

      const { data: order } = await supabase
        .from('orders')
        .select('id, status')
        .eq('stripe_payment_intent_id', piId)
        .maybeSingle();

      if (!order) {
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'charge_not_in_db',
          stripe_id: charge.id,
          detail: `Stripe charge ${charge.id} (PI: ${piId}) has no matching order in DB`,
        });
        alerts.push(`charge_not_in_db: ${charge.id}`);
      }
    }

    // 2. Check our paid orders against Stripe
    const { data: paidOrders } = await supabase
      .from('orders')
      .select('id, stripe_payment_intent_id, stripe_charge_id')
      .eq('status', 'paid')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString());

    for (const order of paidOrders ?? []) {
      if (!order.stripe_charge_id) {
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'order_paid_no_charge',
          order_id: order.id,
          detail: `Order ${order.id} status=paid but has no stripe_charge_id`,
        });
        alerts.push(`order_paid_no_charge: ${order.id}`);
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[reconcile-orders] error:', msg);
    return errorResponse(`Reconciliation failed: ${msg}`, 500);
  }

  return successResponse({ reconciled: true, alerts_created: alerts.length, alerts });
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/resend-webhook/ supabase/functions/reconcile-orders/
git commit -m "feat(edge): resend-webhook (delivery tracking) + reconcile-orders (daily drift detection)"
```

---

## Task 12: QA — Backend

- [ ] **Step 1: Run TypeScript checks on all new edge functions**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
# Check each function with Deno (edge functions use Deno runtime)
for fn in create-product-order stripe-product-webhook connect-business-stripe \
           staff-approve-product update-order-shipped refund-order \
           get-orders-buyer get-orders-business process-email-queue \
           resend-webhook reconcile-orders; do
  echo "Checking $fn..."
  deno check supabase/functions/$fn/index.ts 2>&1 | head -5
done
```

- [ ] **Step 2: Run mobile tests to ensure migrations didn't break anything**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: all existing tests pass.

- [ ] **Step 3: Verify all migrations applied cleanly**

```bash
npx supabase db diff
```

Expected: no pending changes.

- [ ] **Step 4: Push to origin**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
git push origin main
```

- [ ] **Step 5: Set remaining env secrets**

```bash
# Remote (Supabase project)
npx supabase secrets set \
  STRIPE_PRODUCT_WEBHOOK_SECRET=whsec_your_secret \
  RESEND_API_KEY=re_your_key \
  RESEND_WEBHOOK_SECRET=whsec_your_resend_webhook_secret \
  --project-ref ptymtdlysqbpxzlgsshp

# Local dev (.env in supabase/functions/)
# Add to supabase/functions/.env:
# STRIPE_PRODUCT_WEBHOOK_SECRET=whsec_test_...
# RESEND_API_KEY=re_test_...
# RESEND_WEBHOOK_SECRET=whsec_test_...
```

- [ ] **Step 6: Final commit**

```bash
git add .claude/log.md
git commit -m "chore: update session log — marketplace backend complete"
```

---

**Plan 1 complete.** Proceed to Plan 2 (Studio) or Plan 3 (Mobile) — both can now be worked in parallel.
