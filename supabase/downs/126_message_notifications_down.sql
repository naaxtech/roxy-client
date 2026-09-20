DROP TRIGGER IF EXISTS trg_notify_direct_message ON public.messages;
DROP FUNCTION IF EXISTS public.notify_direct_message();

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('friend_request','friend_accept','community_event'));
-- Re-tightening fails if 'message' rows already exist; delete them first.
