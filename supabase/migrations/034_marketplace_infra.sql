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
