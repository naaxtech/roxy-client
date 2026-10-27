-- ============================================================
-- 140_supporter_entitlements.sql
--
-- Roxy Supporter, slice S1: the entitlement backbone. A RevenueCat webhook
-- (edge function revenuecat-webhook, service role) is the only writer; every
-- perk gate in S2 asks public.is_supporter(uid).
--
-- Spec: docs/superpowers/specs/2026-10-26-roxy-supporter-design.md (§1)
-- Plan: docs/superpowers/plans/2026-10-26-supporter-s1-entitlements.md
-- Down: supabase/downs/140_supporter_entitlements_down.sql
-- Proof: supabase/tests/140_supporter_entitlements_check.sql
--
-- Shape:
--   supporter_subscriptions  one row per store subscription (the truth). A
--                            member can hold several at once: a cancelled
--                            monthly still running beside a new yearly, or
--                            Play and web. Each row has its own event clock.
--   supporter_entitlements   one row per member: her best subscription,
--                            derived by _supporter_refresh(). What the app reads.
--   supporter_events         every webhook event, append-only, idempotent.
--
-- The RevenueCat specifics (which event means what) live in
-- supabase/functions/_shared/revenuecat.ts. This file only knows "effects":
--   activate | grace | expire | refund   change one subscription, guarded by event time
--   transfer                             moves subscriptions between members
--   cancel | change | log                informational: logged, nothing changes
--
--   supporter_webhook_rejections  deliveries the webhook refused (§9), for support.
--
-- Expand only: four new tables, five functions, two platform_settings
-- columns that default OFF. Nothing existing changes behaviour.
-- ============================================================

-- ── 1. switches ─────────────────────────────────────────────────────────────
-- platform_settings (021) is service-only and 131 revoked it from every client
-- role; it also holds fee settings. It stays sealed: clients read the kill
-- switch through supporter_enabled() below.
--   supporter_enabled        OFF = the paywall says "Coming soon" and every
--                            gate behaves as for a free member (is_supporter
--                            is false). Events are still recorded.
--   supporter_sandbox_counts OFF = store sandbox purchases (Play license
--                            testers, Web Billing test mode) are recorded but
--                            unlock nothing. ON only for a test window.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS supporter_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supporter_sandbox_counts boolean NOT NULL DEFAULT false;

-- ── 2. one row per store subscription ──────────────────────────────────────
-- id = 'txn:' || RevenueCat original_transaction_id ("transaction_id of the
-- original transaction in the subscription" — stable across renewals), or
-- 'user:<uid>:product:<product_id>' when RevenueCat sends none. The store is
-- deliberately NOT part of the key: RevenueCat sends `store` only "sometimes",
-- and a storeless EXPIRATION must land on the same row as the purchase.
-- src: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields · 2026-10-26
CREATE TABLE IF NOT EXISTS public.supporter_subscriptions (
  id                       text        PRIMARY KEY,
  user_id                  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                   text        NOT NULL,
  -- 'infinity' = lifetime (RevenueCat sends a null expiration for those).
  period_ends_at           timestamptz,
  -- RevenueCat's store, lower-cased: play_store, rc_billing, app_store, ...
  -- Format-checked, not enumerated: a store RevenueCat adds later must not
  -- make the money path fail.
  store                    text,
  product_id               text,
  environment              text        NOT NULL,
  original_transaction_ref text,
  -- Generation time of the newest event applied to THIS subscription: the
  -- out-of-order guard.
  last_event_at            timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supporter_subscriptions_id_check CHECK (length(id) BETWEEN 1 AND 300),
  CONSTRAINT supporter_subscriptions_status_check
    CHECK (status IN ('active', 'grace', 'expired', 'refunded')),
  CONSTRAINT supporter_subscriptions_environment_check
    CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT supporter_subscriptions_store_check
    CHECK (store IS NULL OR store ~ '^[a-z_]{1,32}$'),
  CONSTRAINT supporter_subscriptions_product_check
    CHECK (product_id IS NULL OR length(product_id) BETWEEN 1 AND 200),
  CONSTRAINT supporter_subscriptions_ref_check
    CHECK (original_transaction_ref IS NULL OR length(original_transaction_ref) BETWEEN 1 AND 200)
);

-- is_supporter, the summary and TRANSFER all look subscriptions up by member.
CREATE INDEX IF NOT EXISTS supporter_subscriptions_user_idx
  ON public.supporter_subscriptions (user_id);

ALTER TABLE public.supporter_subscriptions ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand anon and authenticated ALL on a new
-- table. She reads her own rows; nothing a client sends can write one.
REVOKE ALL ON TABLE public.supporter_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supporter_subscriptions TO authenticated;

DROP POLICY IF EXISTS supporter_subscriptions_select_own ON public.supporter_subscriptions;
CREATE POLICY supporter_subscriptions_select_own ON public.supporter_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.supporter_subscriptions IS
  'Roxy Supporter: one row per store subscription (key txn:<original_transaction_id>). Read: own rows. Write: apply_supporter_event() only. Gate on is_supporter().';

-- ── 3. her entitlement summary, one row per member ─────────────────────────
-- Derived, never written directly: _supporter_refresh() copies her best
-- subscription here (live before lapsed, production before sandbox, longest
-- period first). last_event_at is the newest event across her subscriptions.
CREATE TABLE IF NOT EXISTS public.supporter_entitlements (
  user_id                  uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                   text        NOT NULL,
  period_ends_at           timestamptz,
  store                    text,
  product_id               text,
  environment              text        NOT NULL,
  original_transaction_ref text,
  last_event_at            timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supporter_entitlements_status_check
    CHECK (status IN ('active', 'grace', 'expired', 'refunded')),
  CONSTRAINT supporter_entitlements_environment_check
    CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT supporter_entitlements_store_check
    CHECK (store IS NULL OR store ~ '^[a-z_]{1,32}$'),
  CONSTRAINT supporter_entitlements_product_check
    CHECK (product_id IS NULL OR length(product_id) BETWEEN 1 AND 200),
  CONSTRAINT supporter_entitlements_ref_check
    CHECK (original_transaction_ref IS NULL OR length(original_transaction_ref) BETWEEN 1 AND 200)
);

ALTER TABLE public.supporter_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supporter_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supporter_entitlements TO authenticated;

DROP POLICY IF EXISTS supporter_entitlements_select_own ON public.supporter_entitlements;
CREATE POLICY supporter_entitlements_select_own ON public.supporter_entitlements
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.supporter_entitlements IS
  'Roxy Supporter summary, one row per member: her best subscription (derived by _supporter_refresh). Read: own row. For display; gate on is_supporter(), not on this row.';

-- ── 4. every webhook event, append-only ────────────────────────────────────
-- id = RevenueCat event.id, which retries reuse, so a replay is a no-op.
-- src: https://www.revenuecat.com/docs/integrations/webhooks · 2026-10-26
--      ("at least one delivery"; track the event id, process each once)
-- Kept for support, refunds and the money-path analytics; the typed columns
-- are the churn timeline (purchase → cancel → billing issue → expire / renew).
-- `payload` holds an allowlist of RevenueCat fields chosen by the edge
-- function: never subscriber_attributes ($email lives there) nor country_code.
CREATE TABLE IF NOT EXISTS public.supporter_events (
  id          text        PRIMARY KEY,
  user_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  type        text        NOT NULL,
  effect      text        NOT NULL,
  environment text,
  -- What apply_supporter_event did with it; set in the same transaction.
  result      text,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  event_at    timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supporter_events_id_check CHECK (length(id) BETWEEN 1 AND 128),
  CONSTRAINT supporter_events_type_check CHECK (type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT supporter_events_effect_check
    CHECK (effect IN ('activate', 'grace', 'expire', 'refund', 'cancel', 'change', 'transfer', 'log')),
  CONSTRAINT supporter_events_environment_check
    CHECK (environment IS NULL OR environment IN ('sandbox', 'production')),
  CONSTRAINT supporter_events_result_check
    CHECK (result IS NULL OR result IN ('applied', 'stale', 'logged', 'unknown_user'))
);

-- Support looks her history up by member, newest first.
CREATE INDEX IF NOT EXISTS supporter_events_user_idx
  ON public.supporter_events (user_id, event_at DESC);

ALTER TABLE public.supporter_events ENABLE ROW LEVEL SECURITY;

-- Service role only. No grant, and a restrictive deny so a later broad GRANT
-- still exposes nothing.
REVOKE ALL ON TABLE public.supporter_events FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS supporter_events_no_client ON public.supporter_events;
CREATE POLICY supporter_events_no_client ON public.supporter_events
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.supporter_events IS
  'Append-only log of RevenueCat webhook events (id = event.id). Service role only. Written by apply_supporter_event().';

-- ── 5. her summary, recomputed from her subscriptions ──────────────────────
-- Internal: called by apply_supporter_event (definer, so it runs as the table
-- owner). No client role can execute it.
CREATE OR REPLACE FUNCTION public._supporter_refresh(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_best public.supporter_subscriptions%ROWTYPE;
  v_last timestamptz;
BEGIN
  IF p_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_best
    FROM public.supporter_subscriptions s
   WHERE s.user_id = p_uid
   -- coalesce: a live status with a NULL period (a BILLING_ISSUE with no
   -- expiration and no grace end) makes this NULL, and NULL sorts FIRST under
   -- DESC — it would outrank a paid, running subscription.
   ORDER BY coalesce(s.status IN ('active', 'grace') AND s.period_ends_at > now(), false) DESC,
            (s.environment = 'production') DESC,
            s.period_ends_at DESC NULLS LAST,
            s.last_event_at DESC,
            s.id
   LIMIT 1;

  IF NOT FOUND THEN
    -- Everything she had moved to someone else.
    UPDATE public.supporter_entitlements
       SET status = 'expired', updated_at = now()
     WHERE user_id = p_uid AND status <> 'expired';
    RETURN;
  END IF;

  SELECT max(s.last_event_at) INTO v_last FROM public.supporter_subscriptions s WHERE s.user_id = p_uid;

  INSERT INTO public.supporter_entitlements AS t
    (user_id, status, period_ends_at, store, product_id, environment, original_transaction_ref, last_event_at)
  VALUES (p_uid, v_best.status, v_best.period_ends_at, v_best.store, v_best.product_id,
          v_best.environment, v_best.original_transaction_ref, v_last)
  ON CONFLICT (user_id) DO UPDATE SET
    status                   = EXCLUDED.status,
    period_ends_at           = EXCLUDED.period_ends_at,
    store                    = EXCLUDED.store,
    product_id               = EXCLUDED.product_id,
    environment              = EXCLUDED.environment,
    original_transaction_ref = EXCLUDED.original_transaction_ref,
    last_event_at            = EXCLUDED.last_event_at,
    updated_at               = now();
END;
$$;

REVOKE ALL ON FUNCTION public._supporter_refresh(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. is_supporter: the one question every perk gate asks ─────────────────
-- True iff the kill switch is on and ANY of her subscriptions is active or in
-- grace, inside its period, and from production — or from sandbox while
-- supporter_sandbox_counts is on. Reads the subscriptions, not the summary,
-- so it is exact for any mix of stores and environments. Public by design:
-- S2 shows the mark to other members, so asking about someone else is allowed.
CREATE OR REPLACE FUNCTION public.is_supporter(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.supporter_subscriptions s
      JOIN public.platform_settings ps ON ps.id = 1
     WHERE s.user_id = p_uid
       AND ps.supporter_enabled
       AND s.status IN ('active', 'grace')
       AND s.period_ends_at > now()
       AND (s.environment = 'production'
            OR (s.environment = 'sandbox' AND ps.supporter_sandbox_counts))
  );
$$;

REVOKE ALL ON FUNCTION public.is_supporter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_supporter(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_supporter(uuid) IS
  'Roxy Supporter gate. Kill switch + any subscription active/grace with period_ends_at > now(), production (or sandbox while supporter_sandbox_counts).';

-- ── 7. the kill switch, readable by members ────────────────────────────────
CREATE OR REPLACE FUNCTION public.supporter_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT s.supporter_enabled FROM public.platform_settings s WHERE s.id = 1), false);
$$;

REVOKE ALL ON FUNCTION public.supporter_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supporter_enabled() TO authenticated, service_role;

-- ── 8. apply one webhook event ─────────────────────────────────────────────
-- Order of work:
--   1. log the event; an id already logged returns 'duplicate' and stops.
--   2. informational effects (cancel, change, log) stop at 'logged': they never
--      create a row and never move a clock, so they cannot make an older state
--      event that arrives after them look stale.
--      src: https://www.revenuecat.com/docs/integrations/webhooks/event-flows · 2026-10-26
--           (PRODUCT_CHANGE is dispatched alongside the RENEWAL / INITIAL_PURCHASE
--            that carries the new period; a cancelled subscription keeps access
--            to period end)
--   3. a state effect applies to ONE subscription, only if it is newer than
--      that subscription's last_event_at, else 'stale' — billing-issue events
--      "can arrive in a different order" (same page). A newer event naming a
--      different member moves the subscription to her (its TRANSFER is still
--      in flight).
--   4. TRANSFER moves the sources' subscriptions to the destination; to a
--      non-member they expire. Either way the source loses them: "the
--      entitlements will be removed from user 1". Which ones: those of the
--      event's store when it names one; when it does not (TRANSFER's `store`
--      is "Sometimes"), only device-store ones (v_restorable) — a transfer is
--      a store restore, and a restore cannot carry a card-paid web purchase.
-- Locks: the subscription key first, then members in uuid order, so two
-- deliveries never interleave on one subscription or one summary.
--
-- Returns: duplicate | applied | stale | logged | unknown_user.
CREATE OR REPLACE FUNCTION public.apply_supporter_event(
  p_event_id                 text,
  p_type                     text,
  p_effect                   text,
  p_user_id                  uuid,
  p_event_at                 timestamptz,
  p_environment              text        DEFAULT NULL,
  p_period_ends_at           timestamptz DEFAULT NULL,
  p_store                    text        DEFAULT NULL,
  p_product_id               text        DEFAULT NULL,
  p_original_transaction_ref text        DEFAULT NULL,
  p_from_user_ids            uuid[]      DEFAULT NULL,
  p_payload                  jsonb       DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user    uuid;
  v_owner   uuid;
  v_lock    uuid;
  v_key     text;
  v_status  text;
  v_result  text;
  v_moved   integer;
  v_sources uuid[] := coalesce(p_from_user_ids, '{}'::uuid[]);
  v_sub     public.supporter_subscriptions%ROWTYPE;
  -- Stores whose purchases a device "Restore purchases" brings back: RC's
  -- restore reactivates "content that had previously been purchased from the
  -- same store account (Apple, Google, or Amazon)"; Apple = App Store + Mac
  -- App Store. A TRANSFER is RC moving those to the restoring App User ID.
  -- src: https://www.revenuecat.com/docs/getting-started/restoring-purchases · 2026-10-28
  -- src: https://www.revenuecat.com/docs/projects/restore-behavior · 2026-10-28
  --      (transfer: an App User ID "tries to restore transactions that are
  --       already associated with a different identified App User ID")
  -- Store names as RC sends them, lower-cased (event-types-and-fields).
  v_restorable CONSTANT text[] := ARRAY['amazon', 'app_store', 'mac_app_store', 'play_store'];
BEGIN
  -- The grant already limits this to service_role. The body says so too, so
  -- a later accidental GRANT TO authenticated still cannot mint an entitlement
  -- (131 records that happening to claim_speed_date_partner).
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'apply_supporter_event is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_effect IS NULL
     OR p_effect NOT IN ('activate', 'grace', 'expire', 'refund', 'cancel', 'change', 'transfer', 'log') THEN
    RAISE EXCEPTION 'unknown supporter effect %', p_effect USING ERRCODE = '22023';
  END IF;
  IF p_event_id IS NULL OR p_type IS NULL OR p_event_at IS NULL THEN
    RAISE EXCEPTION 'event id, type and time are required' USING ERRCODE = '22023';
  END IF;
  IF p_effect NOT IN ('transfer', 'log') AND p_environment IS NULL THEN
    RAISE EXCEPTION 'effect % needs an environment', p_effect USING ERRCODE = '22023';
  END IF;
  IF p_effect IN ('activate', 'grace', 'expire', 'refund')
     AND p_original_transaction_ref IS NULL AND p_product_id IS NULL THEN
    RAISE EXCEPTION 'effect % names no subscription', p_effect USING ERRCODE = '22023';
  END IF;

  -- Only a real member's id is stored or acted on.
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.id = p_user_id;

  INSERT INTO public.supporter_events (id, user_id, type, effect, environment, payload, event_at)
  VALUES (p_event_id, v_user, p_type, p_effect, p_environment, coalesce(p_payload, '{}'::jsonb), p_event_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  IF p_effect IN ('cancel', 'change', 'log') THEN
    v_result := 'logged';

  ELSIF p_effect = 'transfer' THEN
    FOR v_lock IN
      SELECT DISTINCT u FROM unnest(array_append(v_sources, v_user)) AS u WHERE u IS NOT NULL ORDER BY u
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('supporter:' || v_lock::text, 0));
    END LOOP;

    -- Which of the sources' subscriptions a transfer carries: those of the
    -- store it names, else (no store on the event) only those a device-store
    -- restore can carry — never a card-paid web, Stripe, Paddle or
    -- promotional one, nor one whose store we never learned.
    IF v_user IS NOT NULL THEN
      UPDATE public.supporter_subscriptions s
         SET user_id = v_user, last_event_at = p_event_at, updated_at = now()
       WHERE s.user_id = ANY (v_sources)
         AND s.user_id <> v_user
         AND s.last_event_at < p_event_at
         AND CASE WHEN p_store IS NULL THEN s.store = ANY (v_restorable) ELSE s.store = p_store END;
    ELSE
      UPDATE public.supporter_subscriptions s
         SET status = 'expired', last_event_at = p_event_at, updated_at = now()
       WHERE s.user_id = ANY (v_sources)
         AND s.last_event_at < p_event_at
         AND CASE WHEN p_store IS NULL THEN s.store = ANY (v_restorable) ELSE s.store = p_store END;
    END IF;
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    IF v_moved > 0 THEN
      FOR v_lock IN
        SELECT DISTINCT u FROM unnest(array_append(v_sources, v_user)) AS u WHERE u IS NOT NULL
      LOOP
        PERFORM public._supporter_refresh(v_lock);
      END LOOP;
      v_result := 'applied';
    ELSIF v_user IS NULL THEN
      v_result := 'unknown_user';
    ELSE
      v_result := 'logged';
    END IF;

  ELSIF v_user IS NULL THEN
    v_result := 'unknown_user';

  ELSE
    v_key := CASE
               WHEN p_original_transaction_ref IS NOT NULL THEN 'txn:' || p_original_transaction_ref
               ELSE 'user:' || v_user::text || ':product:' || p_product_id
             END;
    PERFORM pg_advisory_xact_lock(hashtextextended('supporter_sub:' || v_key, 0));
    SELECT s.user_id INTO v_owner FROM public.supporter_subscriptions s WHERE s.id = v_key;
    FOR v_lock IN
      SELECT DISTINCT u FROM unnest(ARRAY[v_user, v_owner]) AS u WHERE u IS NOT NULL ORDER BY u
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('supporter:' || v_lock::text, 0));
    END LOOP;

    SELECT * INTO v_sub FROM public.supporter_subscriptions s WHERE s.id = v_key;
    IF FOUND AND v_sub.last_event_at >= p_event_at THEN
      v_result := 'stale';
    ELSE
      v_status := CASE p_effect
                    WHEN 'activate' THEN 'active'
                    WHEN 'grace'    THEN 'grace'
                    WHEN 'expire'   THEN 'expired'
                    WHEN 'refund'   THEN 'refunded'
                  END;
      INSERT INTO public.supporter_subscriptions AS t
        (id, user_id, status, period_ends_at, store, product_id, environment, original_transaction_ref, last_event_at)
      VALUES (v_key, v_user, v_status, p_period_ends_at, p_store, p_product_id, p_environment,
              p_original_transaction_ref, p_event_at)
      ON CONFLICT (id) DO UPDATE SET
        user_id                  = EXCLUDED.user_id,
        status                   = EXCLUDED.status,
        period_ends_at           = EXCLUDED.period_ends_at,
        store                    = coalesce(EXCLUDED.store, t.store),
        product_id               = coalesce(EXCLUDED.product_id, t.product_id),
        environment              = EXCLUDED.environment,
        original_transaction_ref = coalesce(EXCLUDED.original_transaction_ref, t.original_transaction_ref),
        last_event_at            = EXCLUDED.last_event_at,
        updated_at               = now();
      PERFORM public._supporter_refresh(v_user);
      IF v_owner IS DISTINCT FROM v_user THEN
        PERFORM public._supporter_refresh(v_owner);
      END IF;
      v_result := 'applied';
    END IF;
  END IF;

  UPDATE public.supporter_events SET result = v_result WHERE id = p_event_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_supporter_event(
  text, text, text, uuid, timestamptz, text, timestamptz, text, text, text, uuid[], jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_supporter_event(
  text, text, text, uuid, timestamptz, text, timestamptz, text, text, text, uuid[], jsonb
) TO service_role;

COMMENT ON FUNCTION public.apply_supporter_event(
  text, text, text, uuid, timestamptz, text, timestamptz, text, text, text, uuid[], jsonb
) IS 'Service role only (revenuecat-webhook). Idempotent on event id; each subscription guarded by event time. Returns duplicate|applied|stale|logged|unknown_user.';

-- ── 9. refused deliveries, kept for support ────────────────────────────────
-- An event the function will not apply still names itself: a payload shape it
-- refuses (a field missing or malformed), or a purchase it cannot attach to a
-- member (unknown_user). It is recorded here and answered 200. RevenueCat
-- counts anything but 200 as a failure and retries the SAME payload 5 times
-- over about 80 minutes, then stops; a retry cannot fix a payload, so a 4xx
-- would spend those retries and leave the event only on RevenueCat's
-- failed-delivery list, with nothing on our side for support to find.
-- src: https://www.revenuecat.com/docs/integrations/webhooks · 2026-10-28
--      ("Any other status code will be considered a failure"; "After 5
--       retries, we will stop sending notifications"; "Retries reuse the
--       payload id and event_timestamp_ms")
-- The cost: a 200 takes it off that failed list (whose Retry button resends
-- it). After a parser fix, replay a refused event from RevenueCat by its
-- event_id from this table (plan › Not in this slice).
-- Support looks a member up by sha256(her member uuid) — the function hashes
-- her uuid when the event carries one, else RevenueCat's app_user_id. The
-- raw id is never stored (CHECK below), and the reason is a field name or
-- 'unknown_user', never a value from the payload.
CREATE TABLE IF NOT EXISTS public.supporter_webhook_rejections (
  event_id         text        NOT NULL,
  event_type       text        NOT NULL,
  reason           text        NOT NULL,
  app_user_id_hash text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supporter_webhook_rejections_pkey PRIMARY KEY (event_id, reason),
  CONSTRAINT supporter_webhook_rejections_event_id_check CHECK (length(event_id) BETWEEN 1 AND 128),
  CONSTRAINT supporter_webhook_rejections_type_check CHECK (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT supporter_webhook_rejections_reason_check CHECK (reason ~ '^[a-z][a-z0-9_.]{0,63}$'),
  CONSTRAINT supporter_webhook_rejections_hash_check
    CHECK (app_user_id_hash IS NULL OR app_user_id_hash ~ '^[0-9a-f]{64}$')
);

-- Support's lookup: her hash, newest first.
CREATE INDEX IF NOT EXISTS supporter_webhook_rejections_hash_idx
  ON public.supporter_webhook_rejections (app_user_id_hash, received_at DESC)
  WHERE app_user_id_hash IS NOT NULL;

ALTER TABLE public.supporter_webhook_rejections ENABLE ROW LEVEL SECURITY;

-- Service role only, like supporter_events: no grant, and a restrictive deny.
REVOKE ALL ON TABLE public.supporter_webhook_rejections FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS supporter_webhook_rejections_no_client ON public.supporter_webhook_rejections;
CREATE POLICY supporter_webhook_rejections_no_client ON public.supporter_webhook_rejections
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.supporter_webhook_rejections IS
  'RevenueCat deliveries refused by revenuecat-webhook (bad shape, or unknown_user), one row per (event, reason). Service role only. app_user_id_hash = sha-256 hex, never the raw id.';

CREATE OR REPLACE FUNCTION public.record_supporter_webhook_rejection(
  p_event_id         text,
  p_event_type       text,
  p_reason           text,
  p_app_user_id_hash text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same belt and braces as apply_supporter_event: the grant AND the body.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_supporter_webhook_rejection is service-role only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.supporter_webhook_rejections (event_id, event_type, reason, app_user_id_hash)
  VALUES (p_event_id, p_event_type, p_reason, p_app_user_id_hash)
  ON CONFLICT (event_id, reason) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'recorded' ELSE 'duplicate' END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_supporter_webhook_rejection(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_supporter_webhook_rejection(text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.record_supporter_webhook_rejection(text, text, text, text) IS
  'Service role only (revenuecat-webhook). Records a refused delivery once per (event, reason). Returns recorded|duplicate.';
