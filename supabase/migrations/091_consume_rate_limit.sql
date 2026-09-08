-- ============================================================
-- 091_consume_rate_limit.sql
--
-- A rate limiter that counts rows only it can write.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- `_shared/rateLimit.ts` split one decision across two exported functions:
-- `checkRateLimit()` COUNTED rows in ai_call_log; `logAiCall()` WROTE them.
-- Nothing made a caller do both, and six of the twelve callers never did:
--
--   cancel-event · create-payment-intent · gdpr-delete
--   gdpr-export  · stripe-dashboard-link · submit-report
--
-- checkRateLimit filters on function_name, so rows written by the OTHER six do
-- not help: each of these six counted a set that is empty by construction.
-- Verified against production 2026-08-07 -- ai_call_log holds 78 rows across
-- five function names, and not one of those six appears. Their caps (10/day,
-- 50/day, 10/day, 5/day, 3/day, 5/day) have returned `allowed` on every request
-- ever made. The 429 branch under each was unreachable code.
--
-- Two further defects in the same helper, both fail-open:
--
--   * `const { count } = await query;` discarded `error`. On ANY PostgREST
--     failure -- timeout, network, RLS -- count is null, `count ?? 0` is 0, and
--     0 < maxCount, so the limiter ALLOWED. That one hit all twelve callers,
--     not six.
--
--   * Check and write were separate round trips with the guarded work between
--     them. Two concurrent requests both read count = 9 against a cap of 10 and
--     both proceed. Confirmed as a genuine READ COMMITTED race: a plain SELECT
--     "sees a snapshot of the database as of the instant the query begins" and
--     never sees a concurrent uncommitted row, and the re-check that rescues
--     UPDATE applies only to found target rows -- the rows here do not exist
--     yet, so there is nothing to block on.
--     src: https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED · PostgreSQL 17 · 2026-08-07
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- Decide and record in one transaction, so recording is not a step a caller can
-- omit -- it is how the answer is computed. A caller cannot hold this function
-- wrong: there is no way to ask "am I under the cap" without consuming.
--
-- ── WHY AN ADVISORY LOCK AND NOT SERIALIZABLE ───────────────────────────────
-- SSI would catch this -- it is byte-for-byte the write-skew example in the
-- manual (read an aggregate, insert into the predicate you just read). But
-- Postgres "does not offer an automatic retry facility, since it cannot do so
-- with any guarantee of correctness", and PostgREST runs each RPC in its own
-- transaction, so the retry would have to live in the Edge Function: an HTTP
-- retry loop distinguishing a serialization abort from a real 500 by
-- string-matching `body.code === '40001'` inside a 500. Through supabase-js
-- that arrives as `{ data: null, error }` and never throws -- the exact defect
-- class this migration exists to remove.
--   src: https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html · PostgreSQL 17 · 2026-08-07
--   src: https://docs.postgrest.org/en/v13/references/errors.html · PostgREST 13 · 2026-08-07
--
-- ── WHY THE TWO-ARGUMENT LOCK FORM ──────────────────────────────────────────
-- Advisory locks are per-DATABASE, not cluster-wide. On Supabase that is the
-- `postgres` database we share with pg_cron, pgmq, Realtime and Auth, so being
-- "local to the database" buys no isolation from them. The documented isolation
-- mechanism is the disjoint key space: "identified either by a single 64-bit key
-- value or two 32-bit key values (note that these two key spaces do not
-- overlap)". A fixed namespace in key1 is therefore a GUARANTEE; a 64-bit hash
-- would only be a probability.
--   src: https://www.postgresql.org/docs/17/view-pg-locks.html · PostgreSQL 17 · 2026-08-07
--   src: https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS · PostgreSQL 17 · 2026-08-07
--
-- TRANSACTION-scoped, never session-scoped. pg_advisory_xact_lock is "released
-- at the end of the transaction, and there is no explicit unlock operation" --
-- including on abort, which is what distinguishes it from the session form that
-- explicitly survives a rollback. PgBouncer's own feature matrix marks
-- session-level advisory locks "Never" under transaction pooling, because the
-- lock outlives the connection handback and is inherited by whichever unrelated
-- client next receives that backend. The transaction form is released AT commit,
-- so nothing survives the handback and it is safe in every pooling mode.
--   src: https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS · PostgreSQL 17 · 2026-08-07
--   src: https://www.pgbouncer.org/features.html · pgbouncer · 2026-08-07
--
-- Contention is per (user, function): only the same woman's concurrent calls to
-- the same function ever queue, which is rare and sub-millisecond. The statement
-- timeout below bounds it anyway; without it the ceiling would be the
-- authenticator role's 8s, which is long enough to be visible to her.
--   src: https://supabase.com/docs/guides/database/postgres/timeouts · Supabase · 2026-08-07
--
-- ── WHY date_trunc TAKES AN EXPLICIT ZONE ───────────────────────────────────
-- Two-argument date_trunc on a timestamptz truncates in the SESSION's TimeZone.
-- Supabase defaults every database to UTC, so `date_trunc('day', now())` would
-- be correct today -- incidentally. TimeZone is settable per-database and
-- per-role, and PostgREST applies impersonated-role settings per transaction, so
-- a future `ALTER ROLE authenticated SET timezone` would silently move every
-- woman's daily reset by hours with no error anywhere, under a paid feature gate
-- (CLAUDE.md section 16: free tier is 3 AI calls/day, server-enforced). The
-- three-argument form is zone-independent and still index-usable, because it
-- returns timestamptz and needs no cast to compare against called_at.
--
-- Do NOT "simplify" this to date_trunc('day', now() AT TIME ZONE 'UTC'):
-- AT TIME ZONE on a timestamptz returns a timestamp WITHOUT time zone, and
-- comparing that against a timestamptz column re-applies the session TimeZone --
-- reintroducing exactly the bug being removed.
--   src: https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-TRUNC · PostgreSQL 17 · 2026-08-07
--   src: https://supabase.com/docs/guides/database/postgres/configuration · Supabase · 2026-08-07
--
-- This preserves the TypeScript it replaces (`new Date().toISOString()
-- .split('T')[0]` + 'T00:00:00.000Z'), which was genuinely UTC.
-- ============================================================

-- 4207 is Roxy's advisory-lock namespace. Any other component in this database
-- that wants an advisory lock must use a different key1, or the single-bigint
-- space, which the manual guarantees cannot collide with this one.
-- Registry of key1 values, one line per owner:
--   4207 — consume_rate_limit (this file)

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_user_id         uuid,
  p_fn_name         text,
  p_max_count       int,
  p_window_type     text,
  p_conversation_id uuid    DEFAULT NULL,
  p_was_mock        boolean DEFAULT false
)
RETURNS TABLE (allowed boolean, current_count int, call_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '3s'
AS $$
DECLARE
  v_count int;
  v_id    uuid;
BEGIN
  -- Guard the lock key before taking it. A NULL anywhere in the concatenation
  -- makes the whole key NULL, and the manual does not state whether
  -- pg_advisory_xact_lock is STRICT -- if it is, a NULL key acquires NO LOCK,
  -- silently, with no error, and this function would look like it works while
  -- protecting nothing. That is the `block_user` defect shape exactly: a control
  -- that reports success over an operation that never happened. Unverifiable
  -- behaviour is not something to depend on in either direction.
  --
  -- The message names WHICH argument was null and never the value: a user id in
  -- a Postgres log is PII under the observability rules, which require it hashed
  -- before it reaches any log.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'consume_rate_limit: p_user_id is required';
  END IF;
  IF p_fn_name IS NULL OR p_fn_name = '' THEN
    RAISE EXCEPTION 'consume_rate_limit: p_fn_name is required';
  END IF;
  IF p_max_count IS NULL OR p_max_count < 0 THEN
    RAISE EXCEPTION 'consume_rate_limit: p_max_count must be a non-negative integer';
  END IF;
  IF p_window_type IS NULL OR p_window_type NOT IN ('daily', 'lifetime', 'conversation') THEN
    RAISE EXCEPTION 'consume_rate_limit: p_window_type must be daily, lifetime or conversation';
  END IF;

  -- The TypeScript this replaces read `windowType === 'conversation' &&
  -- conversationId` and, when the id was missing, silently dropped the filter --
  -- turning a per-conversation cap into a per-lifetime one. That direction
  -- happens to be stricter rather than fail-open, so it was never noticed, but a
  -- cap that quietly changes meaning is not a cap. All three callers that use
  -- this window (roxy-sister, roxy-nudge, roxy-icebreaker) do pass the id, so
  -- demanding it costs nothing and removes the silent reinterpretation.
  IF p_window_type = 'conversation' AND p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'consume_rate_limit: p_conversation_id is required when p_window_type is conversation';
  END IF;

  PERFORM pg_advisory_xact_lock(4207, hashtext(p_user_id::text || ':' || p_fn_name));

  SELECT count(*)::int INTO v_count
  FROM public.ai_call_log
  WHERE user_id = p_user_id
    AND function_name = p_fn_name
    AND (p_window_type <> 'daily'        OR called_at >= date_trunc('day', now(), 'UTC'))
    AND (p_window_type <> 'conversation' OR conversation_id = p_conversation_id);

  IF v_count >= p_max_count THEN
    -- Refused. Nothing is written, so a refusal never consumes a slot and a
    -- woman who is already at her cap cannot be pushed further from it by
    -- retrying.
    RETURN QUERY SELECT false, v_count, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.ai_call_log (user_id, function_name, was_mock, conversation_id)
  VALUES (p_user_id, p_fn_name, coalesce(p_was_mock, false), p_conversation_id)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_count + 1, v_id;
END;
$$;

COMMENT ON FUNCTION public.consume_rate_limit(uuid, text, int, text, uuid, boolean) IS
  'Atomically counts and records one call against a per-(user, function) cap. Replaces the checkRateLimit/logAiCall pair, whose two halves could be -- and in six of twelve callers were -- used independently, leaving those caps unenforced since the day they were written. Serialised per (user, function) by a transaction-scoped advisory lock in namespace 4207. Returns call_id so a caller can refund an attempt that never reached the resource it was protecting.';

-- ── The refund path ─────────────────────────────────────────────────────────
-- Recording per ATTEMPT rather than per SUCCESS is deliberate and is the safe
-- direction: a caller who forgets to refund over-counts, costing that woman one
-- slot. The old design's forgetful path was the fail-open one, which is why this
-- defect existed at all.
--
-- It is still a real cost where the cap is small. roxy-onboarding's is LIFETIME,
-- max 1: without a refund, one transient Anthropic 500 locks a woman out of her
-- onboarding recommendations permanently, with no path back that does not
-- involve us editing her row by hand.
--
-- Deleting by id and user together means a stolen or guessed call_id cannot
-- refund somebody else's consumed slot.
CREATE OR REPLACE FUNCTION public.refund_rate_limit(
  p_user_id uuid,
  p_call_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '3s'
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_user_id IS NULL OR p_call_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.ai_call_log
  WHERE id = p_call_id AND user_id = p_user_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.refund_rate_limit(uuid, uuid) IS
  'Releases a slot consumed by consume_rate_limit when the guarded work never reached the resource. Scoped by user_id as well as call_id so one member cannot refund another''s slot. Returns false rather than raising when the row is already gone -- a refund is best-effort by nature and must never turn a handled failure into an unhandled one.';

-- ── Who may call these ──────────────────────────────────────────────────────
-- Edge functions hold the service-role key (_shared/auth.ts getSupabaseClient),
-- so service_role is the only caller that needs EXECUTE. Postgres grants EXECUTE
-- to PUBLIC on a new function by default, and PUBLIC includes anon -- which on a
-- SECURITY DEFINER function would let an unauthenticated caller write rows into
-- ai_call_log for any user id they cared to name, burning another woman's daily
-- AI quota from outside the app. Naming PUBLIC in the REVOKE matters: a
-- privilege held by PUBLIC is held by every role, and revoking it from the roles
-- individually would leave the PUBLIC grant standing.
REVOKE ALL ON FUNCTION public.consume_rate_limit(uuid, text, int, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_rate_limit(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit(uuid, text, int, text, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_rate_limit(uuid, uuid)
  TO service_role;

-- ── Index ───────────────────────────────────────────────────────────────────
-- The daily and lifetime windows are served by idx_ai_log_user_fn_time
-- (user_id, function_name, called_at DESC) from 001. The conversation window
-- filters on user_id + function_name + conversation_id; 004's
-- idx_ai_log_conversation is (conversation_id, function_name) and does not lead
-- with user_id, so the count above would fall back to a scan of every row for
-- that conversation. Three functions use that window (roxy-sister 10,
-- roxy-nudge 3, roxy-icebreaker 1) and the count now runs while holding a lock,
-- so a slow count is a queue for that woman, not merely a slow query.
CREATE INDEX IF NOT EXISTS idx_ai_log_user_fn_conversation
  ON public.ai_call_log (user_id, function_name, conversation_id)
  WHERE conversation_id IS NOT NULL;

-- ── A note on the table's name ──────────────────────────────────────────────
-- Six of this table's writers are not AI calls, which makes `ai_call_log` a
-- misnomer. Renaming it is a migration whose only product is a better noun, and
-- function_name already carries the real meaning. Recorded rather than fixed.
COMMENT ON TABLE public.ai_call_log IS
  'Per-call audit log AND the rate-limit ledger -- consume_rate_limit both reads and writes it, which is what makes the caps enforceable. Despite the name it is not AI-only: cancel-event, create-payment-intent, gdpr-delete, gdpr-export, stripe-dashboard-link and submit-report are rate-limited through it too. Write ONLY via consume_rate_limit; a direct insert re-creates the split that left six caps unenforced.';
