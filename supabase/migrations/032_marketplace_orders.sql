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
