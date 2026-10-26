-- 137 down — reverses 137_notification_archive.sql.
-- Run only inside a transaction you have backed up. Drops archived_at: every
-- notification a member cleared comes back into her inbox (as read, since a
-- clear also marked it read). No notification row is deleted.
-- Leaves 057/131 as they were: UPDATE (read_at) for authenticated, and
-- idx_notifications_user_created / idx_notifications_user_unread untouched.
-- destructive-ok: down file

DROP FUNCTION IF EXISTS public.unarchive_notifications(uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.archive_notifications(uuid[], timestamptz);

DROP TRIGGER IF EXISTS trg_notifications_stamp_archived ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_stamp_archived();

DROP INDEX IF EXISTS public.idx_notifications_user_archived;
DROP INDEX IF EXISTS public.idx_notifications_user_inbox;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_archived_after_created;

-- Only the column 137 added; read_at keeps the grant 057 gave it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'archived_at'
  ) THEN
    REVOKE UPDATE (archived_at) ON public.notifications FROM authenticated;
  END IF;
END $$;

ALTER TABLE public.notifications DROP COLUMN IF EXISTS archived_at;
