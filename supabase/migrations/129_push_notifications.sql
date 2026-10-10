-- 129 — Push notifications that actually arrive
--
-- What was broken (production, 2026-10-04): push_tokens held 0 rows and allowed
-- one device per user; the only push path was the SENDER's phone calling
-- send-message-push, which needed an EXPO_ACCESS_TOKEN secret that was never
-- set; friend requests, accepts, events and channel messages never pushed;
-- profiles.notification_preferences existed and nothing read it.
--
-- The model after this migration:
--
--   notifications (the in-app list) stays the single source of truth. A row
--   inserted there also lands in push_outbox. The push-dispatch edge function
--   drains the outbox: it reads the recipient's devices and preferences,
--   skips muted / blocked / already-read / switched-off notifications, builds
--   lock-screen-safe copy, sends to Expo in batches of 100, retries with
--   backoff, checks receipts and disables dead tokens.
--
--   The outbox is woken two ways, both optional, so this migration can never
--   break a write:
--     1. an AFTER INSERT trigger on push_outbox calls the dispatcher through
--        pg_net (sub-second delivery), only when the two Vault secrets below
--        exist;
--     2. a pg_cron sweep every minute picks up anything missed and every retry.
--   Both are configured by scripts/setup-push.sql AFTER this migration, by a
--   human, because they need the project URL and the service-role key in Vault.
--   Until then rows simply wait in the outbox — nothing is lost, nothing fails.
--
-- Defaults (Nicole, 2026-10-04): every type ON, lock-screen previews OFF.
--
-- Backfill: none. The 108 unread notifications already in the table are NOT
-- queued — a phone lighting up with a month of history the day this ships
-- would be the worst first impression push can make.
--
-- Down: supabase/downs/129_push_notifications_down.sql

-- ── 1. Devices: many per user ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version  text,
  enabled      boolean NOT NULL DEFAULT true,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_devices_token_shape CHECK (token ~ '^Expo(nent)?PushToken\[[^]]{1,180}\]$')
);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

-- She can see her own devices (a future "signed-in devices" screen). Writes go
-- only through register_push_device / unregister_push_device below: a token
-- moving between accounts on a shared phone has to be handled atomically, and a
-- direct INSERT could not take a token row that belongs to someone else.
DROP POLICY IF EXISTS push_devices_select_own ON public.push_devices;
CREATE POLICY push_devices_select_own ON public.push_devices
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.push_devices FROM anon, authenticated;
GRANT SELECT ON public.push_devices TO authenticated;

CREATE INDEX IF NOT EXISTS idx_push_devices_user_enabled
  ON public.push_devices (user_id) WHERE enabled;

-- The single-row-per-user push_tokens (065) is superseded. Its rows (0 on
-- production) are carried over so nothing is dropped; the table itself stays
-- until a later contract migration so an older build that still upserts there
-- keeps working.
INSERT INTO public.push_devices (user_id, token, platform, last_seen_at)
SELECT pt.user_id, pt.token, 'android', pt.updated_at
FROM public.push_tokens pt
WHERE pt.token ~ '^Expo(nent)?PushToken\[[^]]{1,180}\]$'
ON CONFLICT (token) DO NOTHING;

CREATE OR REPLACE FUNCTION public.register_push_device(
  p_token text, p_platform text, p_app_version text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[^]]{1,180}\]$' THEN
    RAISE EXCEPTION 'invalid push token' USING ERRCODE = '22023';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid platform' USING ERRCODE = '22023';
  END IF;
  -- A token identifies a device. If someone else signed in on this phone
  -- before, the token moves to her: the previous account must stop receiving
  -- this woman's pushes on a phone it no longer holds.
  INSERT INTO public.push_devices (user_id, token, platform, app_version, enabled, last_error, last_seen_at)
  VALUES (auth.uid(), p_token, p_platform, left(p_app_version, 40), true, NULL, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id      = EXCLUDED.user_id,
        platform     = EXCLUDED.platform,
        app_version  = EXCLUDED.app_version,
        enabled      = true,
        last_error   = NULL,
        last_seen_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.push_devices WHERE token = p_token AND user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

-- ── 2. Preferences: one row per user, defaults when absent ─────────────────

CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_enabled    boolean NOT NULL DEFAULT true,
  messages        boolean NOT NULL DEFAULT true,
  friends         boolean NOT NULL DEFAULT true,
  events          boolean NOT NULL DEFAULT true,
  community_chats boolean NOT NULL DEFAULT true,
  show_previews   boolean NOT NULL DEFAULT false,
  quiet_start     time,
  quiet_end       time,
  timezone        text NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 64),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_settings_select_own ON public.notification_settings;
CREATE POLICY notification_settings_select_own ON public.notification_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notification_settings_insert_own ON public.notification_settings;
CREATE POLICY notification_settings_insert_own ON public.notification_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notification_settings_update_own ON public.notification_settings;
CREATE POLICY notification_settings_update_own ON public.notification_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.notification_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_settings TO authenticated;

-- ── 3. The outbox ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts        int  NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  ticket_ids      text[] NOT NULL DEFAULT '{}',
  receipts_checked_at timestamptz,
  skip_reason     text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

-- Service-role only: no policy for anon or authenticated, so RLS denies both.
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_push_outbox_due
  ON public.push_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_push_outbox_receipts
  ON public.push_outbox (sent_at) WHERE status = 'sent' AND receipts_checked_at IS NULL;

CREATE OR REPLACE FUNCTION public.enqueue_push()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.push_outbox (notification_id, user_id)
  VALUES (NEW.id, NEW.user_id)
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push is a courtesy; the in-app notification is the record. Never let
  -- the outbox fail the write that created the notification.
  RAISE WARNING 'enqueue_push failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enqueue_push ON public.notifications;
CREATE TRIGGER trg_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_push();

-- Claim due rows for one dispatcher run. SKIP LOCKED lets several runs (the
-- instant wake-up and the cron sweep) overlap without double-sending; a row a
-- crashed run left in 'sending' is reclaimed after two minutes.
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit int DEFAULT 500)
RETURNS SETOF public.push_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.push_outbox o
     SET status = 'sending', locked_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.push_outbox
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'sending' AND locked_at < now() - interval '2 minutes')
      ORDER BY next_attempt_at
      LIMIT LEAST(GREATEST(p_limit, 1), 1000)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_push_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(int) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_push() FROM PUBLIC, anon, authenticated;

-- ── 4. Wake-ups (configured later, by a human) ─────────────────────────────

-- Reads the two Vault secrets scripts/setup-push.sql creates. Returns quietly
-- when they are absent or pg_net is not installed, so a project that has not
-- run setup yet keeps writing notifications exactly as before.
CREATE OR REPLACE FUNCTION public.wake_push_dispatcher()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'roxy_push_dispatch_url'$q$ INTO v_url;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'roxy_service_role_key'$q$ INTO v_key;
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 5000)$q$
    USING v_url, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wake_push_dispatcher failed: %', SQLERRM;
END $$;

REVOKE ALL ON FUNCTION public.wake_push_dispatcher() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wake_push_dispatcher() TO service_role;

-- Statement-level on `notifications`, not on push_outbox: enqueue_push runs once
-- per notification row and each of its INSERTs is its own statement, so a
-- statement trigger on push_outbox would fire once PER ROW. On notifications, a
-- community event fanning out to 2,000 members (one INSERT ... SELECT) wakes
-- the dispatcher ONCE. (Caught by T10 in supabase/tests/129_push_notifications_check.sql.)
CREATE OR REPLACE FUNCTION public.push_outbox_wake()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.wake_push_dispatcher();
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.push_outbox_wake() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_outbox_wake ON public.push_outbox;
DROP TRIGGER IF EXISTS trg_notifications_push_wake ON public.notifications;
CREATE TRIGGER trg_notifications_push_wake
  AFTER INSERT ON public.notifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.push_outbox_wake();

-- ── 5. Friend-request notifications follow the request ─────────────────────

-- Cancelled or declined: the "sent you a friend request" row is deleted (its
-- outbox row goes with it by cascade). Accepted: the request notification is
-- marked read, so the bell stops counting a request that is already answered.
CREATE OR REPLACE FUNCTION public.cleanup_friend_request_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'pending' THEN
    DELETE FROM public.notifications
     WHERE user_id = OLD.addressee_id AND actor_id = OLD.requester_id AND type = 'friend_request';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    UPDATE public.notifications SET read_at = COALESCE(read_at, now())
     WHERE user_id = NEW.addressee_id AND actor_id = NEW.requester_id AND type = 'friend_request';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'cleanup_friend_request_notification failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_friend_request_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cleanup_friend_request_notification ON public.friendships;
CREATE TRIGGER trg_cleanup_friend_request_notification
  AFTER UPDATE OR DELETE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_friend_request_notification();

-- The orphans already there (2 on production): request notifications whose
-- request no longer exists. Scoped by WHERE to exactly those rows.
DELETE FROM public.notifications n
 WHERE n.type = 'friend_request'
   AND NOT EXISTS (
     SELECT 1 FROM public.friendships f
      WHERE f.requester_id = n.actor_id AND f.addressee_id = n.user_id
   );

-- ── 6. Opening a conversation clears its notifications ─────────────────────

CREATE OR REPLACE FUNCTION public.mark_notifications_read_for_link(p_link_path text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = now()
   WHERE user_id = auth.uid() AND link_path = p_link_path AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.mark_notifications_read_for_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read_for_link(text) TO authenticated;
