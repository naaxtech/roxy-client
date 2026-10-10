-- One-time setup for the push pipeline, run by a HUMAN after migration 129 and
-- after `npx supabase functions deploy push-dispatch`. Not a migration: it holds
-- a secret and must never be committed with real values.
--
-- Run in the Supabase SQL editor (production) with the two values filled in:
--   :project_ref       e.g. ptymtdlysqbpxzlgsshp
--   :service_role_key  Dashboard › Project Settings › API keys › service_role
--
-- What it does:
--   1. enables pg_net (HTTP from Postgres) and pg_cron (scheduler)
--   2. stores the dispatcher URL and the service-role key in Supabase Vault
--      (encrypted at rest; wake_push_dispatcher() reads them by name)
--   3. schedules a sweep every minute: retries, anything the instant wake-up
--      missed, and receipt checks
--
-- Safe to re-run: secrets are replaced, the cron job is re-created.
-- Undo: see the bottom of supabase/downs/129_push_notifications_down.sql.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  v_ref text := 'REPLACE_WITH_PROJECT_REF';
  v_key text := 'REPLACE_WITH_SERVICE_ROLE_KEY';
BEGIN
  IF v_ref LIKE 'REPLACE_%' OR v_key LIKE 'REPLACE_%' THEN
    RAISE EXCEPTION 'Fill in v_ref and v_key first (and do not save this file with them).';
  END IF;

  DELETE FROM vault.secrets WHERE name IN ('roxy_push_dispatch_url', 'roxy_service_role_key');
  PERFORM vault.create_secret(
    'https://' || v_ref || '.supabase.co/functions/v1/push-dispatch',
    'roxy_push_dispatch_url', 'push-dispatch endpoint (migration 129)');
  PERFORM vault.create_secret(
    v_key, 'roxy_service_role_key', 'service role key used to wake push-dispatch');
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'roxy-push-dispatch';
SELECT cron.schedule('roxy-push-dispatch', '* * * * *', $$SELECT public.wake_push_dispatcher()$$);

-- Check: both secrets present, one job scheduled.
SELECT name FROM vault.decrypted_secrets WHERE name LIKE 'roxy_%';
SELECT jobname, schedule FROM cron.job WHERE jobname = 'roxy-push-dispatch';
