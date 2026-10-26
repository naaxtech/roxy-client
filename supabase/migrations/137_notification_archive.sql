-- 137 — clear a notification into her archive (Roxy, slice notifications-clear).
--
-- Why: an inbox that can't be emptied fills with noise and members stop
-- opening it (owner 2026-10-26: "Notifications should be archived when
-- cleared, user should be able to clear notifications").
--
-- What:
--   1. `notifications.archived_at` — set when she clears a row, NULL again on
--      Undo / Restore. Clearing never deletes: the duplicate checks that read
--      past rows (133 notify_follow, 136 notify_post_reaction) keep seeing a
--      cleared notification, so it does not fire again.
--   2. CHECK archived_at >= created_at, and a BEFORE UPDATE trigger that stamps
--      archived_at with the server clock. The client sends its own time; a
--      phone running a few seconds slow would otherwise trip the CHECK on a
--      notification that just arrived, and the clear would fail.
--   3. Two partial indexes: the inbox (archived_at IS NULL, newest first) and
--      the archive (archived_at IS NOT NULL, most recently cleared first).
--      057's idx_notifications_user_created and idx_notifications_user_unread
--      stay exactly as they are: the duplicate checks and the profiles
--      ON DELETE CASCADE read every row, archived or not, and installed builds
--      count unread with `read_at IS NULL` alone.
--   4. Column grant widened by one column: members may UPDATE read_at and
--      archived_at, nothing else. The UPDATE policy (own rows, TO
--      authenticated, 057/131) already limits the write to her own rows.
--   5. Clear and Undo as RPCs, one UPDATE each: archive_notifications (by ids,
--      or everything up to a timestamp, 500 rows per call) archives and marks
--      read in the same statement and returns which rows were unread before;
--      unarchive_notifications restores and un-reads exactly those, 500 per
--      call. Two client writes (archive, then
--      mark read) could half-apply, and an empty result could not be told
--      from a failed write. SECURITY INVOKER, so the RLS and column grant of
--      4. still decide what she may touch.
--
-- Expand only: no column, index, policy or grant from 057/131 changes, so
-- installed builds keep working. The client that filters on archived_at must
-- ship after this is applied.
-- Down: supabase/downs/137_notification_archive_down.sql.
-- Proof: supabase/tests/137_notification_archive_check.sql.

-- ── 1. the column ──────────────────────────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.notifications.archived_at IS
  'When she cleared it from her inbox (server clock). NULL = in the inbox. Cleared rows are kept, never deleted, and never counted in a badge.';

-- ── 2. never before it arrived; the server's clock, not the phone's ────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_archived_after_created;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_archived_after_created
  CHECK (archived_at IS NULL OR archived_at >= created_at);

CREATE OR REPLACE FUNCTION public.notifications_stamp_archived()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notifications_stamp_archived() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_stamp_archived ON public.notifications;
CREATE TRIGGER trg_notifications_stamp_archived
BEFORE UPDATE OF archived_at ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notifications_stamp_archived();

-- ── 3. inbox and archive reads ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_inbox
  ON public.notifications (user_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_archived
  ON public.notifications (user_id, archived_at DESC) WHERE archived_at IS NOT NULL;

-- ── 4. members may clear and restore; nothing else becomes writable ────────
GRANT UPDATE (read_at, archived_at) ON public.notifications TO authenticated;

-- ── 5. clear and Undo, one statement each ──────────────────────────────────
-- Exactly one of p_ids / p_up_to. p_up_to is "everything on her screen": pass
-- the created_at of the newest row she loaded (server clock, not the phone's),
-- so a notification that arrived after the screen loaded stays in the inbox;
-- a row created exactly at p_up_to is included.
-- Returns one row per notification archived by THIS call, with whether it was
-- unread before; nothing left to clear is an empty set, not an error.
-- At most 500 rows per call, her newest first: config.toml's max_rows = 1000
-- would cut a longer reply short (the client would never learn those ids, so
-- Undo could not restore them), and unarchive_notifications takes 500 ids at a
-- time. Clear all calls again with the same p_up_to until a call returns fewer
-- than 500. Rows are locked in one total order (created_at DESC, id), so two
-- devices clearing at once cannot deadlock.
CREATE OR REPLACE FUNCTION public.archive_notifications(
  p_ids   uuid[]      DEFAULT NULL,
  p_up_to timestamptz DEFAULT NULL
)
RETURNS TABLE (id uuid, was_unread boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF (p_ids IS NULL) = (p_up_to IS NULL) THEN
    RAISE EXCEPTION 'pass exactly one of p_ids or p_up_to' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'p_ids holds at most 500 ids' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH target AS (
    SELECT n.id, n.read_at IS NULL AS was_unread
      FROM public.notifications n
     WHERE n.user_id = auth.uid()
       AND n.archived_at IS NULL
       AND (p_ids IS NULL OR n.id = ANY (p_ids))
       AND (p_up_to IS NULL OR n.created_at <= p_up_to)
     ORDER BY n.created_at DESC, n.id
     LIMIT 500
       FOR UPDATE
  )
  UPDATE public.notifications n
     SET archived_at = now(),
         read_at     = COALESCE(n.read_at, now())
    FROM target t
   WHERE n.id = t.id
  RETURNING n.id, t.was_unread;
END $$;

-- Undo / Restore: un-archives her archived rows in p_ids and clears read_at on
-- those also in p_mark_unread (the ids archive_notifications reported as
-- was_unread). Returns how many came back; a row deleted meanwhile, or one
-- that was never archived, is not counted.
CREATE OR REPLACE FUNCTION public.unarchive_notifications(
  p_ids         uuid[],
  p_mark_unread uuid[] DEFAULT '{}'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unread   uuid[] := COALESCE(p_mark_unread, '{}');
  v_restored integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL THEN
    RAISE EXCEPTION 'p_ids is required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_ids) > 500 OR cardinality(v_unread) > 500 THEN
    RAISE EXCEPTION 'p_ids and p_mark_unread hold at most 500 ids each' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_unread <@ p_ids) THEN
    RAISE EXCEPTION 'p_mark_unread must be a subset of p_ids' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notifications n
     SET archived_at = NULL,
         read_at     = CASE WHEN n.id = ANY (v_unread) THEN NULL ELSE n.read_at END
   WHERE n.user_id = auth.uid()
     AND n.archived_at IS NOT NULL
     AND n.id = ANY (p_ids);
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  RETURN v_restored;
END $$;

REVOKE ALL ON FUNCTION public.archive_notifications(uuid[], timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unarchive_notifications(uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_notifications(uuid[], timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unarchive_notifications(uuid[], uuid[]) TO authenticated;
