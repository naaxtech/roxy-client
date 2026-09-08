-- ============================================================
-- 093_dm_permissions_and_unblock_down.sql
--
-- Undoes 093. Dropping the trigger first matters: while it exists without its
-- helper functions every direct conversation insert would fail, so the order
-- here is the reverse of the order there.
-- ============================================================

DROP TRIGGER IF EXISTS enforce_dm_permission_on_insert ON public.conversations;
DROP FUNCTION IF EXISTS public.enforce_dm_permission();
DROP FUNCTION IF EXISTS public.share_a_friend(uuid, uuid);
DROP FUNCTION IF EXISTS public.are_friends(uuid, uuid);

DROP FUNCTION IF EXISTS public.blocked_profiles();
DROP FUNCTION IF EXISTS public.unblock_user(uuid);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_dm_permission_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS dm_permission;
