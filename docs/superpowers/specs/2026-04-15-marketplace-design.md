# Roxy Marketplace — Design Spec
**Date:** 2026-04-15
**Author:** Nicole Claire Marie A. Azachee
**Status:** Approved for implementation planning

---

## 1. Overview

A WLW business marketplace embedded inside Roxy's BUILD tab. Businesses registered and accepted by Roxy staff sell physical products directly to Roxy users. Products are listed and managed in Roxy Studio (seller dashboard). Roxy staff approve every product before it appears in the app. Buyers purchase inside the BusinessDetailSheet. Stripe handles all money movement. Roxy takes a percentage per sale via application fee — no fund holding.

**Design principle:** Stripe is the ledger. We are the mirror. An order in our DB = always paid. Always.

---

## 2. Scope

| In scope | Out of scope |
|---|---|
| Physical goods only | Digital downloads |
| Per-business cart | Cross-business cart |
| Stripe Connect Express | Custom/Standard Connect |
| Staff product approval | Automated approval |
| Seller manages fulfillment | Roxy-managed fulfillment |
| Flat platform fee % | Tiered fee by subscription |
| Studio seller dashboard | Separate seller mobile app |

---

## 3. Data Layer

### 3.1 Migrations

**Next migration: 031**

#### businesses table additions (031)

```sql
ALTER TABLE businesses
  ADD COLUMN currency             text        NOT NULL DEFAULT 'usd',
  ADD COLUMN stripe_account_id    text,
  ADD COLUMN stripe_onboarded_at  timestamptz,
  ADD COLUMN can_sell             boolean     NOT NULL DEFAULT false,
  ADD COLUMN payout_schedule_set  boolean     NOT NULL DEFAULT false;
-- stripe_account_id: direct Stripe Express account ID — no join needed at checkout
-- can_sell: set true via account.updated / capability.updated webhook (not manual toggle)
-- payout_schedule_set: confirmed 7-day delay + weekly schedule configured at onboarding
```

#### profiles table additions (031)

```sql
ALTER TABLE profiles
  ADD COLUMN stripe_customer_id      text,
  ADD COLUMN last_shipping_address   jsonb;
-- stripe_customer_id: created at first checkout, reused forever
--   enables Link, saved cards, Stripe invoice history — never logged
-- last_shipping_address: pre-fills Address Element on repeat checkout
--   { name, line1, line2, city, state, postal_code, country }
--   updated when buyer checks [Save for next time] — PII tier-1, never logged
```

#### products (031)

```sql
CREATE TABLE products (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

CREATE TABLE product_variants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
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

CREATE TABLE product_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  alt_text    text,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
  -- trigger: max 5 per product
);
```

#### orders + order_items + order_events (032)

```sql
CREATE TABLE orders (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id                  uuid        NOT NULL REFERENCES profiles(id),
  business_id               uuid        NOT NULL REFERENCES businesses(id),
  status                    text        NOT NULL DEFAULT 'paid'
                                        CHECK (status IN (
                                          'paid','shipped','delivered',
                                          'refunded','cancelled'
                                        )),
  -- shipping address (flat columns — queryable, indexable, no JSONB)
  shipping_name             text        NOT NULL,
  shipping_line1            text        NOT NULL,
  shipping_line2            text,
  shipping_city             text        NOT NULL,
  shipping_state            text        NOT NULL,
  shipping_postal_code      text        NOT NULL,
  shipping_country          text        NOT NULL DEFAULT 'US',
  -- financials — all populated from Stripe webhook, never client-computed
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
-- No pending_payment status. Order created = order paid. Always.
-- stripe_payment_intent_id is idempotency key for webhook handler.

CREATE TABLE order_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        uuid        REFERENCES products(id),
  variant_id        uuid        REFERENCES product_variants(id),
  product_name      text        NOT NULL,
  variant_label     text,
  unit_price_cents  integer     NOT NULL,
  quantity          integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total_cents  integer     GENERATED ALWAYS AS (unit_price_cents * quantity) STORED,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event       text        NOT NULL CHECK (event IN (
                            'payment_confirmed','shipped','delivered',
                            'cancelled','refunded','note_added'
                          )),
  note        text,
  metadata    jsonb,
  actor_type  text        NOT NULL CHECK (actor_type IN ('buyer','business','staff','system')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

#### refunds (032)

```sql
CREATE TABLE refunds (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid        NOT NULL REFERENCES orders(id),
  amount_cents      integer     NOT NULL CHECK (amount_cents > 0),
  reason            text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','succeeded','failed')),
  stripe_refund_id  text        UNIQUE NOT NULL,
  initiated_by      text        NOT NULL CHECK (initiated_by IN ('buyer','business','staff')),
  created_at        timestamptz NOT NULL DEFAULT now()
  -- trigger: SUM(refunds.amount_cents) WHERE order_id = NEW.order_id
  --          must not exceed orders.subtotal_cents
);
```

#### disputes (032)

```sql
CREATE TABLE disputes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid        NOT NULL REFERENCES orders(id),
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
```

#### seller_payouts (032)

```sql
CREATE TABLE seller_payouts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES businesses(id),
  stripe_payout_id  text        UNIQUE NOT NULL,
  amount_cents      integer     NOT NULL,
  currency          text        NOT NULL DEFAULT 'usd',
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','paid','failed','cancelled')),
  failure_message   text,
  arrival_date      date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

#### carts (033)

```sql
CREATE TABLE carts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id     uuid        NOT NULL REFERENCES profiles(id),
  business_id  uuid        NOT NULL REFERENCES businesses(id),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, business_id)
);

CREATE TABLE cart_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid        NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES products(id),
  variant_id  uuid        REFERENCES product_variants(id),
  quantity    integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id, variant_id)
);
```

#### webhook_events (034)

```sql
CREATE TABLE webhook_events (
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
-- Captures all Stripe events including failed payments.
-- Staff can query: WHERE event_type = 'payment_intent.payment_failed'
-- to see every failed attempt with amount and reason.
```

#### email_queue (034)

```sql
CREATE TABLE email_queue (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type        text        NOT NULL CHECK (email_type IN (
                                  'order_shipped_buyer',
                                  'product_approved',
                                  'product_rejected',
                                  'refund_notification_buyer',
                                  'dispute_alert_business'
                                )),
  -- Buyer invoices handled by Stripe Invoicing, not email_queue.
  recipient_type    text        NOT NULL CHECK (recipient_type IN ('buyer','business')),
  recipient_user_id uuid        NOT NULL REFERENCES profiles(id),
  order_id          uuid        REFERENCES orders(id),
  product_id        uuid        REFERENCES products(id),
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

CREATE INDEX idx_email_queue_processable
  ON email_queue(next_retry_at)
  WHERE status IN ('pending','failed');

CREATE INDEX idx_email_queue_stuck
  ON email_queue(processing_since)
  WHERE status = 'processing';
```

#### email_delivery_events (034)

```sql
CREATE TABLE email_delivery_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_queue_id    uuid        NOT NULL REFERENCES email_queue(id),
  resend_message_id text        NOT NULL,
  event_type        text        NOT NULL CHECK (event_type IN (
                                  'delivered','bounced','complained','opened','clicked'
                                )),
  raw_payload       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

#### marketplace_settings (034)

```sql
CREATE TABLE marketplace_settings (
  id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_fee_percent       numeric(5,2) NOT NULL DEFAULT 10.00
                                          CHECK (product_fee_percent >= 0
                                                 AND product_fee_percent <= 100),
  min_product_price_cents   integer      NOT NULL DEFAULT 100,
  max_product_photos        integer      NOT NULL DEFAULT 5,
  cart_ttl_days             integer      NOT NULL DEFAULT 7,
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO marketplace_settings DEFAULT VALUES;
```

#### reconciliation_alerts (034)

```sql
CREATE TABLE reconciliation_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type    text        NOT NULL CHECK (alert_type IN (
                              'charge_not_in_db',
                              'order_paid_no_charge',
                              'refund_mismatch',
                              'payout_mismatch',
                              'transfer_missing'
                            )),
  stripe_id     text,
  order_id      uuid        REFERENCES orders(id),
  detail        text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 Triggers

```sql
-- updated_at auto-maintenance
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_product_variants_updated_at
  BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- max 5 photos per product
CREATE OR REPLACE FUNCTION check_product_photo_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM product_photos WHERE product_id = NEW.product_id) >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 photos per product';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_product_photo_limit
  BEFORE INSERT ON product_photos FOR EACH ROW EXECUTE FUNCTION check_product_photo_limit();

-- refund ceiling
CREATE OR REPLACE FUNCTION check_refund_ceiling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total_refunded integer;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO total_refunded
    FROM refunds
    WHERE order_id = NEW.order_id AND status != 'failed';
  IF total_refunded + NEW.amount_cents >
     (SELECT subtotal_cents FROM orders WHERE id = NEW.order_id) THEN
    RAISE EXCEPTION 'Refund amount exceeds order total';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_refund_ceiling
  BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION check_refund_ceiling();
```

### 3.3 Indexes

```sql
CREATE INDEX idx_products_business        ON products(business_id);
CREATE INDEX idx_products_browsable       ON products(business_id, is_active)
                                          WHERE status = 'approved';
CREATE INDEX idx_variants_product         ON product_variants(product_id);
CREATE INDEX idx_orders_buyer             ON orders(buyer_id);
CREATE INDEX idx_orders_business          ON orders(business_id);
CREATE INDEX idx_orders_stripe_pi         ON orders(stripe_payment_intent_id);
CREATE INDEX idx_orders_status            ON orders(status);
CREATE INDEX idx_order_items_order        ON order_items(order_id);
CREATE INDEX idx_order_events_order       ON order_events(order_id);
CREATE INDEX idx_refunds_order            ON refunds(order_id);
CREATE INDEX idx_disputes_order           ON disputes(order_id);
CREATE INDEX idx_seller_payouts_business  ON seller_payouts(business_id);
CREATE INDEX idx_seller_payouts_status    ON seller_payouts(status);
CREATE INDEX idx_cart_items_cart          ON cart_items(cart_id);
CREATE INDEX idx_carts_buyer_biz          ON carts(buyer_id, business_id);
CREATE INDEX idx_webhook_stripe_event     ON webhook_events(stripe_event_id);
CREATE INDEX idx_webhook_event_type       ON webhook_events(event_type);
CREATE INDEX idx_recon_alerts_resolved    ON reconciliation_alerts(resolved_at)
                                          WHERE resolved_at IS NULL;
```

### 3.4 pg_cron jobs

```sql
-- process-email-queue: every minute
SELECT cron.schedule('process-email-queue', '* * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_base_url') || '/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);

-- reconciliation: daily at 2am
SELECT cron.schedule('daily-reconciliation', '0 2 * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.edge_base_url') || '/reconcile-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);

-- purge expired carts: daily at 3am
SELECT cron.schedule('purge-expired-carts', '0 3 * * *',
  $$DELETE FROM carts WHERE expires_at < now()$$
);

-- cleanup sent emails: daily at 4am
SELECT cron.schedule('cleanup-email-queue', '0 4 * * *',
  $$DELETE FROM email_queue WHERE status = 'sent' AND created_at < now() - interval '90 days'$$
);
```

### 3.5 RLS

```
products:
  SELECT → status = 'approved' AND is_active AND NOT is_archived (public)
           OR business.owner_id = auth.uid() (own business, all statuses)
  INSERT/UPDATE/DELETE → business.owner_id = auth.uid()

orders:
  SELECT → buyer_id = auth.uid() OR business.owner_id = auth.uid()
  UPDATE → business.owner_id = auth.uid() (shipped + tracking only)
  INSERT → service role only (webhook handler)

order_items / order_events:
  SELECT → via order ownership (buyer or business owner)
  INSERT → service role only

refunds / disputes:
  SELECT → buyer or business owner via order
  INSERT → service role only

carts / cart_items:
  SELECT/INSERT/UPDATE/DELETE → buyer_id = auth.uid()

seller_payouts:
  SELECT → business.owner_id = auth.uid()
  INSERT/UPDATE → service role only

email_queue / email_delivery_events:
  ALL → service role only

webhook_events / reconciliation_alerts / marketplace_settings:
  ALL → service role only

Staff access: service role key in all staff-facing edge functions
```

---

## 4. Stripe Architecture

### 4.1 Model

**Destination charges** — Roxy is merchant of record. Stripe automatically routes:
```
Buyer pays $X
  → Stripe deducts card processing fee (~2.9% + $0.30)
  → Roxy application_fee_amount deducted (marketplace_settings.product_fee_percent)
  → Remainder transferred to seller's Stripe Express account
  → Stripe auto-pays seller per payout schedule (weekly, Monday, $50 min, 7-day delay)
```

Roxy never holds funds. Stripe moves money automatically.

### 4.2 Stripe features used

| Feature | Purpose |
|---|---|
| Connect Express | Seller onboarding, KYC, bank account, payouts |
| Destination charges + application_fee | Platform fee, automatic seller transfer |
| Payment Sheet (React Native) | Apple Pay, Google Pay, Link, saved cards |
| Stripe Customer object | Saved payment methods, Link, invoice history |
| Address Element | Shipping address with autocomplete |
| Stripe Tax (automatic_tax) | Tax calculation by jurisdiction, seller liable |
| Stripe Invoicing | Buyer + seller receipts (PDF, hosted URL) |
| Stripe Radar | Fraud scoring, risk_level on charge |
| Stripe Sigma | Staff reconciliation, revenue analytics |
| Payment Links | Shareable product URLs for social sharing |
| Stripe Climate | Optional carbon offset at checkout |
| Express Dashboard link | createLoginLink — seller views payouts in Stripe |
| Payout schedule | 7-day delay, weekly Monday, $50 min (set at onboarding) |

### 4.3 Webhook events handled

```
payment_intent.succeeded     → CREATE order + order_items, clear cart
payment_intent.payment_failed → release stock, log to webhook_events, no order
charge.dispute.created       → INSERT disputes, auto-submit evidence, alert staff + seller
charge.dispute.updated       → UPDATE disputes status
charge.refund.updated        → UPDATE refunds status
account.updated              → UPDATE businesses.can_sell (auto, not manual)
capability.updated           → UPDATE businesses.can_sell
payout.paid                  → INSERT seller_payouts (status=paid)
payout.failed                → INSERT seller_payouts (status=failed), alert staff + seller
review.opened                → pause order fulfillment, alert staff
review.closed                → resume fulfillment
transfer.failed              → INSERT reconciliation_alert, alert staff
```

All webhooks: verify Stripe signature first. Check webhook_events for stripe_event_id (idempotency). If exists → return 200, skip. If new → INSERT webhook_events, process.

### 4.4 Payout schedule (set at Connect onboarding)

```
stripe.accounts.update(accountId, {
  settings: {
    payouts: {
      schedule: { interval: 'weekly', weekly_anchor: 'monday' },
      debit_negative_balances: true
    }
  }
})
-- 7-day delay configured on the Connect account itself
-- Minimum payout: $50
-- businesses.payout_schedule_set = true after this call
```

---

## 5. Payment Flow

### 5.1 Happy path

```
1. Buyer taps [Pay $X] in CheckoutSheet
2. Mobile generates idempotency_key (UUID v4)
3. POST create-product-order:
     a. verifyJWT
     b. validate: cart not expired, all products approved + active, businesses.can_sell = true,
                  businesses.stripe_account_id set, businesses.payout_schedule_set = true
     c. atomic stock decrement (FOR UPDATE — 0 rows = 409 Out of Stock)
     d. ensure stripe_customer_id on profiles (create if missing)
     e. stripe.paymentIntents.create:
          amount, currency, customer, application_fee_amount, transfer_data.destination,
          automatic_tax: { enabled: true }, on_behalf_of: seller_stripe_account_id,
          metadata: { buyer_id, business_id, cart_id, idempotency_key, items_json }
     f. return { client_secret }

4. Payment Sheet confirms payment (Apple Pay / Google Pay / card / Link)

5. payment_intent.succeeded webhook:
     a. idempotency check (stripe_event_id in webhook_events → skip)
     b. INSERT webhook_events
     c. check: order with stripe_payment_intent_id already exists → skip (safe retry)
     d. stripe.paymentIntents.retrieve → get charge_id, transfer_id, tax_amount, risk_level
     e. stripe.invoices.create → get invoice_id + hosted_invoice_url
     f. INSERT order (status='paid', all Stripe fields populated)
     g. INSERT order_items (from metadata.items_json, price snapshots)
     h. INSERT order_event (payment_confirmed, system)
     i. INSERT email_queue rows (NOT buyer invoice — Stripe handles that)
     j. DELETE cart_items, UPDATE carts.updated_at
     k. return 200
```

### 5.2 Failure path

```
payment_intent.payment_failed webhook:
  a. idempotency check
  b. INSERT webhook_events (stripe_payment_intent_id, amount, failure_reason)
  c. release stock:
       UPDATE product_variants SET stock = stock + qty WHERE id = variant_id
  d. No order created. Clean.
  e. return 200

Client: Stripe SDK failure callback → re-enable [Pay], show error message
```

### 5.3 Fraud review

```
review.opened webhook:
  a. find order by stripe_payment_intent_id
  b. INSERT order_event (note: 'payment under Stripe review', actor_type: 'system')
  c. flag: do not ship until review.closed
  d. alert staff

review.closed (approved):
  resume normal flow

review.closed (refunded):
  Stripe has refunded — UPDATE order status='refunded'
```

### 5.4 Dispute auto-evidence

```
charge.dispute.created webhook:
  a. find order by stripe_charge_id
  b. INSERT disputes (response_due_by = now() + 7 days)
  c. compile evidence from DB:
       - order_items: product_name, unit_price_cents (product description)
       - orders: shipping_name, shipping_address (customer info)
       - orders: tracking_number, shipped_at (shipping proof)
       - order_events: timeline (fulfillment evidence)
  d. stripe.disputes.update(dispute_id, { evidence: { ... } })
  e. UPDATE disputes SET evidence_submitted_at = now()
  f. INSERT email_queue: dispute_alert_business (7-day deadline urgency)
  g. alert staff dashboard
```

---

## 6. Studio (roxy-studio)

### 6.1 Route structure

```
/stripe-onboarding     Stripe Connect setup
/products              Product list (all statuses)
/products/new          Create product
/products/[id]/edit    Edit product
/orders                Order management
/orders/[id]           Order detail + fulfillment
/payouts               Payout history
/staff/products        Staff approval queue (is_staff = true)
/staff/emails          Dead letter email queue (is_staff = true)
/staff/reconciliation  Reconciliation alerts (is_staff = true)
/staff/disputes        Dispute management (is_staff = true)
```

### 6.2 Stripe Connect onboarding

```
State A — not connected:
  [Connect with Stripe →] → POST connect-business-stripe → Stripe account link
  → Stripe onboarding → return to /stripe-onboarding?status=success

State B — connected, payout schedule pending:
  Auto-configure payout schedule (7-day delay, weekly Monday, $50 min)
  SET businesses.payout_schedule_set = true

State C — awaiting Stripe verification (can_sell = false):
  "Stripe connected. Verification in progress."
  can_sell set automatically via account.updated / capability.updated webhook

State D — verified, can_sell = true:
  "You're approved to sell." [Go to Products →]
  [View Stripe Dashboard →] → stripe.accounts.createLoginLink(accountId)

State E — account issue (Stripe requires action):
  "Action required." [Resolve in Stripe →]
```

### 6.3 Product management

Create/edit form sections:
1. Basic info: name, description, category, base price
2. Photos: up to 5, drag-reorder, alt_text required per photo
3. Variants: toggle on/off → option1 name/values + optional option2 name/values → auto-generate variant grid (price + stock + SKU per row)
4. Shipping: flat shipping cost (per order)

Submit for approval: requires min 1 photo with alt_text, min 1 active variant if has_variants.

### 6.4 Order management

Order list: filter by status. Columns: order short ID, items count, total, date, status.

Order detail:
- Timeline (order_events)
- Items list with snapshots
- Shipping address (rendered, never logged)
- Status actions:
  - `paid` → input tracking number + [Mark Shipped] → UPDATE orders + INSERT order_event + queue shipping email
  - `shipped` → [Mark Delivered] (optional)
  - `paid` or `shipped` → [Cancel + Refund] → POST refund-order

### 6.5 Payout history

```
Current balance (from Stripe API on page load)
Next automatic payout: [date] — ~[$amount]

Payout history:
  Date | Amount | Status
  Apr 14 | $180.00 | ✓ Paid
  Apr 7  | $95.00  | ✓ Paid
  Mar 31 | $210.00 | ✗ Failed [Retry →]

Retry = re-trigger payout via edge function (payout.failed recovery only)
No "Withdraw Now" button for normal use — payouts are automatic.
```

### 6.6 Staff product approval

```
/staff/products — Pending tab (N)

ProductReviewCard:
  Photo carousel, business name, product name, category, price, description, variants, stock
  [Approve] → PATCH status='approved' → push notification to seller
  [Reject ▾] → reason textarea + [Confirm] → PATCH status='rejected', rejection_reason
             → queue product_rejected email to seller
```

---

## 7. Mobile (roxy-client)

### 7.1 Navigation

No new tabs. Everything lives inside BusinessDetailSheet.

```
BUILD tab → BusinessDetailSheet → [Products tab]
              → ProductCard → variant picker
              → [Add to Cart] → sticky cart footer
              → CartDrawer → [Checkout →]
              → CheckoutSheet (3 steps)
              → OrderConfirmationSheet

Profile screen → My Orders section → OrderDetailSheet
```

### 7.2 BusinessDetailSheet — Products tab

Tabs: About | Products | Photos

Products tab:
- Category filter chips (All + product categories)
- 2-column FlashList of ProductCards
- Sticky footer: cart item count + total + [Checkout →] (hidden when cart empty)
- Empty state if no approved products

### 7.3 ProductCard

No variants: single [+ Add to Cart] button.

Has variants: [Add ▾] → inline sheet:
- Option chips per axis (greyed + strikethrough if out of stock)
- Price updates live on selection
- [+ Add to Cart]

Out of stock (no active variants with stock > 0): greyed card, "Sold Out" badge.

### 7.4 CartDrawer

Per-business cart. Swipe up from sticky footer.

Contents: item list with [−] qty [+] and [🗑] remove. Subtotal + shipping + total. [Checkout → $X].

Quantity [+] disabled at variant stock ceiling. Optimistic UI with server sync.

### 7.5 CheckoutSheet (3 steps)

**Step 1 — Review:** items, subtotal, shipping, estimated total (tax added at Step 3 by Stripe).

**Step 2 — Shipping Address:** Address Element (Stripe — handles autocomplete, international validation). Pre-fills from last used address stored in `profiles.last_shipping_address` (JSONB column, added in migration 031). [Save for next time] checkbox updates this field.

**Step 3 — Payment:**
- Payment Sheet (Stripe React Native) — Apple Pay, Google Pay, Link, card
- Shows: Total due (including tax, calculated by Stripe)
- Platform fee disclosure: "Roxy takes X%. Seller receives $Y."
- [Pay $X] disabled until Payment Sheet valid
- On tap: disabled immediately → call create-product-order → presentPaymentSheet → result

### 7.6 OrderConfirmationSheet

Order placed confirmation. Order short ID. "Invoice sent to your email." [View Order Details] [Continue Shopping].

### 7.7 My Orders (profile screen)

Section added above Saved Businesses.

OrderRow: business name, date, item count, total, status badge.

Tap → OrderDetailSheet:
- Order timeline (order_events)
- Items list
- Shipping address
- Tracking number (tappable → carrier URL)
- Stripe invoice link ("View Invoice PDF")
- [Request Refund] if status = 'delivered' (within 30 days)

### 7.8 marketplaceStore (Zustand)

```typescript
marketplaceStore {
  carts: Record<businessId, { cart: Cart, items: CartItem[] }>
  activeCartBusinessId: string | null
  orders: Order[]
  activeOrder: Order | null
  checkoutStep: 'review' | 'shipping' | 'payment' | null
  shippingAddress: ShippingAddress | null
  isProcessingPayment: boolean

  fetchCart(businessId): Promise<void>
  addToCart(businessId, productId, variantId, qty): Promise<void>
  updateQuantity(cartItemId, qty): Promise<void>
  removeFromCart(cartItemId): Promise<void>
  clearCart(businessId): Promise<void>
  fetchOrders(): Promise<void>
}
```

---

## 8. Edge Functions

```
create-product-order
  Input:  { cart_id, shipping_address, idempotency_key }
  Steps:  verifyJWT → validate cart/products/can_sell → atomic stock decrement
          → ensure stripe_customer_id → create PaymentIntent (automatic_tax on)
          → return { client_secret }
  No order created here.

stripe-product-webhook
  Handles: payment_intent.succeeded, payment_intent.payment_failed,
           charge.dispute.created/updated, charge.refund.updated,
           account.updated, capability.updated,
           payout.paid, payout.failed,
           review.opened, review.closed,
           transfer.failed
  All: verify signature → idempotency check → process → return 200

connect-business-stripe
  Creates/retrieves Stripe Express account → configures payout schedule
  → returns onboarding URL or login link

staff-approve-product
  Staff only (is_staff check via service role)
  PATCH product status → approved/rejected + notification

update-order-shipped
  Business owner only
  UPDATE orders: status=shipped, tracking_number, shipped_at
  INSERT order_event + queue shipping notification email

refund-order
  Staff or business owner
  stripe.refunds.create (using stripe_charge_id, not payment_intent_id)
  INSERT refunds → webhook handles status updates

process-email-queue
  pg_cron every minute
  Reset stuck (processing > 5min) → claim batch (FOR UPDATE SKIP LOCKED)
  → fetch buyer email from auth.users (service role) → render → Resend API
  → update status, handle retries + dead_letter

resend-webhook
  Verify Svix signature → INSERT email_delivery_events (PII stripped)
  → bounce/complaint → flag to staff

reconcile-orders
  pg_cron daily 2am
  Fetch Stripe charges for prior day → cross-reference orders table
  INSERT reconciliation_alerts for any drift
```

---

## 9. Email Architecture

**Principle:** transactional outbox pattern. Email written atomically with the triggering DB operation. Decoupled from payment flow. Retried automatically. Dead letter surfaces to staff.

**Provider:** Resend (transactional email, delivery webhooks, React Email templates).

**Buyer invoice:** Stripe Invoicing — not email_queue. Stripe generates PDF, hosts URL, sends automatically. Always accessible.

**Retry schedule:**
```
retry_count 0 → immediate
retry_count 1 → +2 min
retry_count 2 → +10 min
retry_count 3 → +1 hour
retry_count 4 → +6 hours
retry_count 5 → dead_letter (staff dashboard surfaces it)
```

**Payload structures:**

```
order_shipped_buyer:
  { order_short_id, business_name, tracking_number, carrier_url, items_summary }

product_approved:
  { product_name, business_name }

product_rejected:
  { product_name, rejection_reason }

refund_notification_buyer:
  { order_short_id, amount_cents, currency, reason }

dispute_alert_business:
  { order_short_id, dispute_amount_cents, response_due_by, instructions }
```

---

## 10. Security

```
Authentication:
  verifyJWT on every edge function (401 if missing/invalid)
  Business ownership verified server-side — never trust client-passed IDs
  Staff: is_staff = true checked via service role query

A01 Broken Access Control:
  RLS on all tables (Section 3.5)
  orders INSERT: service role only
  email_queue: service role only — client never reads shipping addresses
  stripe_account_id: never returned to client

A03 Injection:
  All DB via parameterized Supabase client — no raw SQL interpolation
  Stripe webhooks: signature verified before any processing

A05 Misconfiguration:
  RLS enabled on all new tables (verified in migration)
  marketplace_settings: service role only
  No table publicly writable

Financial integrity:
  Stock decrement atomic + FOR UPDATE — no oversell possible
  Stock released on payment failure via webhook
  Refund ceiling enforced by DB trigger
  Platform fee calculated server-side — client never sends fee amount
  Price snapshots in order_items — post-order price changes don't affect total
  Order status changed by webhook only — never by client or checkout edge fn
  Idempotency: stripe_payment_intent_id UNIQUE on orders prevents duplicate orders
  Daily reconciliation catches any drift between DB and Stripe

PII:
  shipping_* columns: service role access only, never logged
  Buyer email: auth.users via service role, never stored in edge fn logs
  email_queue: service role only, payload never passed to ObservabilityService
  Log only: { order_id (hashed), email_type, status } — never raw IDs or PII
  Stripe DPA signed before go-live

Stripe webhook security:
  Verify Stripe-Signature header on every webhook request
  Reject unsigned requests with 400
  webhook_events idempotency: check stripe_event_id before processing
```

---

## 11. Testing Plan

### Unit tests (Jest)

```
marketplaceStore:
  addToCart: optimistic update + server sync
  addToCart: caps at variant stock ceiling
  updateQuantity: optimistic rollback on error
  clearCart: removes all items post-checkout

ProductCard:
  no variants: single Add to Cart
  has variants: picker renders, sold-out chips disabled
  price updates on variant selection
  sold-out badge when all variants stock = 0

CartDrawer:
  quantity + disabled at stock ceiling
  remove updates subtotal
  correct total (subtotal + shipping)

CheckoutSheet:
  Pay button disabled until Payment Sheet valid
  Pay button disabled immediately on tap (no double-submit)
  address validation rejects empty required fields
  fee disclosure renders correctly

OrderDetailSheet:
  renders order_events timeline
  tracking number is tappable
  invoice link present when stripe_invoice_url set
```

### Integration tests (Supabase local)

```
Stock reservation:
  concurrent checkout: only first succeeds when stock = 1
  stock released on payment_intent.payment_failed
  stock not decremented on validation failure

Order creation:
  order created only on payment_intent.succeeded (not before)
  duplicate webhook: idempotency check prevents duplicate order
  order not created if cart expired
  order not created if product not approved
  order not created if can_sell = false
  order not created if payout_schedule_set = false

RLS:
  buyer cannot read another buyer's orders or carts
  business owner reads own orders only
  client cannot INSERT into orders directly
  client cannot read email_queue

Refunds:
  refund ceiling trigger: SUM > subtotal raises exception
  partial refund within ceiling succeeds

Email queue:
  order_shipped email queued only after status=shipped
  UNIQUE constraint prevents duplicate type per order per recipient
  stuck rows (processing > 5min) reset to failed
  dead_letter after retry_count = 5

Reconciliation:
  charge with no matching order → alert inserted
  order with status=paid but no Stripe charge → alert inserted
```

### Edge function tests (Deno)

```
create-product-order:
  missing JWT → 401
  cart expired → 400
  product not approved → 400
  can_sell = false → 403
  out-of-stock variant → 409
  valid request → PaymentIntent created, client_secret returned
  no order created (order table untouched)

stripe-product-webhook:
  invalid signature → 400
  duplicate stripe_event_id → 200, no side effects
  payment_intent.succeeded → order created, cart cleared
  payment_intent.payment_failed → stock released, no order created
  payout.failed → seller_payouts inserted (failed), alert queued
  charge.dispute.created → dispute inserted, evidence submitted

process-email-queue:
  stuck rows reset before batch
  SKIP LOCKED prevents double-send on parallel runs
  Resend failure → retry_count++, correct next_retry_at
  retry_count = 5 → dead_letter
```

### Migration tests

```
product_photos trigger: 6th photo raises exception
refund ceiling trigger: over-refund raises exception
updated_at triggers fire on UPDATE
cart UNIQUE(buyer_id, business_id): duplicate raises exception
order stripe_payment_intent_id UNIQUE: duplicate raises exception
marketplace_settings CHECK: fee_percent > 100 raises exception
pg_cron jobs registered: all 4 jobs present
```

---

## 12. PII Contract

```
NEVER LOG:
  orders.shipping_* (all columns)
  profiles.stripe_customer_id
  email_queue.payload
  buyer email (fetched from auth.users for send only, not stored in logs)

LOG ANONYMISED (hash before logging):
  order_id → hashUserId(id)
  buyer_id → hashUserId(id)

SAFE TO LOG:
  order status transitions
  email_type, recipient_type, email status
  product status changes
  business_id (not personal data)
  stripe_event_id (no PII)

Stripe DPA: must be signed before go-live
email_queue retention: sent rows deleted after 90 days
```

---

## 13. Migrations Summary

| Migration | Contents |
|---|---|
| 031 | businesses additions, profiles stripe_customer_id, products, product_variants, product_photos |
| 032 | orders, order_items, order_events, refunds, disputes, seller_payouts |
| 033 | carts, cart_items |
| 034 | webhook_events, email_queue, email_delivery_events, marketplace_settings, reconciliation_alerts, pg_cron jobs |

---

*Roxy Marketplace Design Spec v1.0*
*Approved for implementation planning — 2026-04-15*
