-- ============================================================================
-- scripts/setup-cron.sql — one-time scheduler setup, run by a HUMAN.
--
-- Not a migration. Run it in the Supabase SQL editor (production) AFTER:
--   1. migration 131 is applied (it creates ops_invoke_edge, ops_call_if_exists
--      and ops_cleanup_stale_rooms — this script refuses to run without them);
--   2. the edge functions are deployed (docs/ops/launch-runbook.md, step 5);
--   3. scripts/setup-push.sql has run (it stores roxy_service_role_key in
--      Vault). If you have not run it, fill v_key below instead — and do NOT
--      save this file with the key in it.
--
-- Fill in ONE value: v_ref (the project ref, e.g. ptymtdlysqbpxzlgsshp). It is
-- not a secret; it only builds https://<ref>.supabase.co/functions/v1.
--
-- What it does:
--   * enables pg_net (HTTP from Postgres) and pg_cron (scheduler);
--   * stores roxy_functions_url in Vault; reads roxy_service_role_key from Vault
--     (ops_invoke_edge reads both by name at every run — no key ever sits in a
--     cron command or in cron.job);
--   * schedules the jobs below. Every edge-function job goes through
--     public.ops_invoke_edge(), which returns quietly if Vault/pg_net are
--     missing; every maintenance job a lane may not have shipped yet goes
--     through public.ops_call_if_exists(), which skips a missing function
--     without an error (so a job never fails every night until it lands).
--
-- Safe to re-run: the URL secret is replaced and every job below is
-- unscheduled-if-exists, then scheduled again. Running it twice leaves exactly
-- one copy of each job.
--
-- Jobs (UTC):
--   roxy-email-queue          * * * * *     process-email-queue (Resend sends + retries)
--   roxy-push-dispatch        * * * * *     push-dispatch sweep (retries, receipts). Same job
--                                           name setup-push.sql uses, so the two scripts never
--                                           schedule the sweep twice.
--   roxy-stale-rooms          */10 * * * *  ops_cleanup_stale_rooms(): close rooms left "live"
--   roxy-auto-complete-events 7 * * * *     auto-complete-events (paid events past their end)
--   roxy-applicant-purge      17 3 * * *    purge_expired_applicant_data() (gate, mig 072/130)
--   roxy-account-purge        27 3 * * *    purge_deleted_accounts() — skipped quietly until a
--                                           lane ships it (30-day hard delete after gdpr-delete)
--   roxy-cron-history-trim    37 3 * * *    keep 7 days of cron.job_run_details
--
-- Undo: SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'roxy-%';
--       DELETE FROM vault.secrets WHERE name = 'roxy_functions_url';
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  v_ref text := 'REPLACE_WITH_PROJECT_REF';
  v_key text := NULL;  -- leave NULL when setup-push.sql already stored roxy_service_role_key
BEGIN
  IF v_ref LIKE 'REPLACE_%' THEN
    RAISE EXCEPTION 'Fill in v_ref (the project ref) first.';
  END IF;
  IF v_ref !~ '^[a-z0-9]{20}$' THEN
    RAISE EXCEPTION 'v_ref should be the 20-character project ref (Dashboard > Project Settings > General), got "%"', v_ref;
  END IF;
  IF to_regprocedure('public.ops_invoke_edge(text,jsonb)') IS NULL
     OR to_regprocedure('public.ops_call_if_exists(text)') IS NULL
     OR to_regprocedure('public.ops_cleanup_stale_rooms()') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 131_ops_launch_hardening.sql first (ops_invoke_edge / ops_call_if_exists / ops_cleanup_stale_rooms are missing).';
  END IF;

  DELETE FROM vault.secrets WHERE name = 'roxy_functions_url';
  PERFORM vault.create_secret(
    'https://' || v_ref || '.supabase.co/functions/v1',
    'roxy_functions_url', 'edge functions base URL for pg_cron jobs (scripts/setup-cron.sql)');

  IF v_key IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE name = 'roxy_service_role_key';
    PERFORM vault.create_secret(v_key, 'roxy_service_role_key',
      'service role key used by pg_cron / pg_net to call edge functions');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'roxy_service_role_key') THEN
    RAISE EXCEPTION 'Vault has no roxy_service_role_key: run scripts/setup-push.sql first, or fill v_key (and do not save the file with it).';
  END IF;
END $$;

-- Unschedule-if-exists, so a re-run never leaves duplicates.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('roxy-email-queue', 'roxy-push-dispatch', 'roxy-stale-rooms',
                  'roxy-auto-complete-events', 'roxy-applicant-purge',
                  'roxy-account-purge', 'roxy-cron-history-trim');

SELECT cron.schedule('roxy-email-queue',          '* * * * *',    $$SELECT public.ops_invoke_edge('process-email-queue')$$);
SELECT cron.schedule('roxy-push-dispatch',        '* * * * *',    $$SELECT public.ops_invoke_edge('push-dispatch')$$);
SELECT cron.schedule('roxy-stale-rooms',          '*/10 * * * *', $$SELECT public.ops_cleanup_stale_rooms()$$);
SELECT cron.schedule('roxy-auto-complete-events', '7 * * * *',    $$SELECT public.ops_invoke_edge('auto-complete-events')$$);
SELECT cron.schedule('roxy-applicant-purge',      '17 3 * * *',   $$SELECT public.ops_call_if_exists('public.purge_expired_applicant_data()')$$);
SELECT cron.schedule('roxy-account-purge',        '27 3 * * *',   $$SELECT public.ops_call_if_exists('public.purge_deleted_accounts()')$$);
SELECT cron.schedule('roxy-cron-history-trim',    '37 3 * * *',   $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);

-- Money jobs: OFF at launch (0 paid events on prod). Turn on when paid events
-- / the marketplace go live, after a dry run with Stripe test keys. Each
-- function checks the service key itself (_shared/serviceAuth.ts).
-- SELECT cron.schedule('roxy-process-refunds', '*/15 * * * *', $$SELECT public.ops_invoke_edge('process-refunds')$$);
-- SELECT cron.schedule('roxy-release-payout',  '0 15 * * *',   $$SELECT public.ops_invoke_edge('release-payout')$$);
-- SELECT cron.schedule('roxy-reconcile-orders','45 4 * * *',   $$SELECT public.ops_invoke_edge('reconcile-orders')$$);

-- Check: two secret NAMES (values never shown), seven jobs.
SELECT name FROM vault.secrets WHERE name IN ('roxy_functions_url', 'roxy_service_role_key') ORDER BY name;
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'roxy-%' ORDER BY jobname;
-- After a few minutes: SELECT jobname, status, return_message, start_time
--   FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--   WHERE j.jobname LIKE 'roxy-%' ORDER BY start_time DESC LIMIT 20;
