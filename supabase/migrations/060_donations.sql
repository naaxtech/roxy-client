-- 060: donations — recurring-first support for Roxy (one_time/monthly/yearly).
-- Clients can only SELECT their own rows; no client INSERT/UPDATE/DELETE
-- policies — all writes happen via the service-role client inside the
-- create-donation-checkout edge function (and, later, the Stripe webhook
-- handler that reconciles status). Every statement is retry-safe: a
-- partially-applied run of this migration can be re-pushed without manual
-- repair.

CREATE TABLE IF NOT EXISTS public.donations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_cents                int NOT NULL CHECK (amount_cents >= 500),
  currency                    text NOT NULL DEFAULT 'usd',
  cadence                     text NOT NULL CHECK (cadence IN ('one_time', 'monthly', 'yearly')),
  status                      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'canceled', 'failed')),
  stripe_checkout_session_id  text,
  stripe_subscription_id      text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donations_user_created ON public.donations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_stripe_checkout_session_id ON public.donations (stripe_checkout_session_id);

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "donations_select_own" ON public.donations;
CREATE POLICY "donations_select_own" ON public.donations
  FOR SELECT USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies: clients cannot write rows directly.
-- Writes happen exclusively via the service-role client in edge functions.

CREATE OR REPLACE FUNCTION public.donations_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_donations_updated_at ON public.donations;
CREATE TRIGGER trg_donations_updated_at BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.donations_touch_updated_at();
