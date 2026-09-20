DROP FUNCTION IF EXISTS public.muted_user_ids();
DROP FUNCTION IF EXISTS public.unmute_user(uuid);
DROP FUNCTION IF EXISTS public.mute_user(uuid);
DROP TABLE IF EXISTS public.mutes;
-- notify_direct_message reverts to its 126 form on the next db push; or
-- re-create it without the mute clause if a restore is needed.
