-- supabase/migrations/021_payments.sql

-- fee_tiers: lookup table for platform fee percentages per host tier
CREATE TABLE public.fee_tiers (
  tier_name   text PRIMARY KEY,
  fee_percent numeric(5,2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fee_tiers ENABLE ROW LEVEL SECURITY;
-- Authenticated users can read (host needs to see their fee)
CREATE POLICY "fee_tiers_read" ON public.fee_tiers
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.fee_tiers (tier_name, fee_percent) VALUES
  ('standard', 15.00),
  ('verified',  10.00),
  ('premium',    8.00);

-- host_stripe_accounts: one row per host who initiates Stripe onboarding
CREATE TABLE public.host_stripe_accounts (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_account_id    text UNIQUE NOT NULL,
  onboarding_complete  boolean NOT NULL DEFAULT false,
  payout_delay_days    integer,
  fee_tier             text NOT NULL DEFAULT 'standard' REFERENCES public.fee_tiers(tier_name),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.host_stripe_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hsa_own_read"   ON public.host_stripe_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hsa_own_update" ON public.host_stripe_accounts FOR UPDATE USING (auth.uid() = user_id);

-- platform_settings: single-row table, service role only
CREATE TABLE public.platform_settings (
  id                        integer PRIMARY KEY CHECK (id = 1),
  max_ticket_price_cents    integer NOT NULL DEFAULT 5000,
  default_payout_delay_days integer NOT NULL DEFAULT 0,
  default_fee_percent       numeric(5,2) NOT NULL DEFAULT 10.00,
  updated_by                uuid REFERENCES public.profiles(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- No client access — service role only. No policies = all denied for client roles.

INSERT INTO public.platform_settings (id, max_ticket_price_cents, default_payout_delay_days, default_fee_percent)
VALUES (1, 5000, 0, 10.00);

-- payment_logs: immutable audit log, service role only
CREATE TABLE public.payment_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id  text UNIQUE NOT NULL,
  event_id           uuid REFERENCES public.events(id),
  buyer_id           uuid REFERENCES public.profiles(id),
  host_id            uuid REFERENCES public.profiles(id),
  amount_cents       integer NOT NULL,
  fee_cents          integer NOT NULL,
  host_payout_cents  integer NOT NULL,
  currency           text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  ticket_code        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
-- No client access — service role only.

-- events table additions: price_cents and currency
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS price_cents integer,           -- null = free
  ADD COLUMN IF NOT EXISTS currency    text DEFAULT 'usd';

-- updated_at trigger for host_stripe_accounts
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER hsa_updated_at
  BEFORE UPDATE ON public.host_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
