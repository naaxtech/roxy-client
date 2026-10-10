-- Down for 129_push_notifications.sql. Removes the push pipeline and returns
-- the schema to its 128 shape. push_tokens (065) was never touched by 129, so
-- an older build keeps working after this.
-- destructive-ok: reverses tables created by 129 only; no pre-129 data lives in them

DROP TRIGGER IF EXISTS trg_cleanup_friend_request_notification ON public.friendships;
DROP FUNCTION IF EXISTS public.cleanup_friend_request_notification();

DROP FUNCTION IF EXISTS public.mark_notifications_read_for_link(text);

DROP TRIGGER IF EXISTS trg_notifications_push_wake ON public.notifications;
DROP TRIGGER IF EXISTS trg_push_outbox_wake ON public.push_outbox;
DROP FUNCTION IF EXISTS public.push_outbox_wake();
DROP FUNCTION IF EXISTS public.wake_push_dispatcher();

DROP TRIGGER IF EXISTS trg_enqueue_push ON public.notifications;
DROP FUNCTION IF EXISTS public.enqueue_push();
DROP FUNCTION IF EXISTS public.claim_push_batch(int);
DROP TABLE IF EXISTS public.push_outbox;

DROP TABLE IF EXISTS public.notification_settings;

DROP FUNCTION IF EXISTS public.register_push_device(text, text, text);
DROP FUNCTION IF EXISTS public.unregister_push_device(text);
DROP TABLE IF EXISTS public.push_devices;

-- The cron job and Vault secrets from scripts/setup-push.sql, if they were set up:
--   SELECT cron.unschedule('roxy-push-dispatch');
--   DELETE FROM vault.secrets WHERE name IN ('roxy_push_dispatch_url', 'roxy_service_role_key');
-- The orphaned friend-request notifications 129 deleted are not restored:
-- they pointed at requests that no longer existed.
