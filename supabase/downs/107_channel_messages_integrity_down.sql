-- Undoes 107_channel_messages_integrity.sql.
--
-- Reversing this re-opens both holes: the author can un-delete a moderated
-- message, and a moderator can rewrite another woman's words.

drop trigger if exists community_channel_messages_guard on public.community_channel_messages;
drop function if exists public.community_channel_messages_guard();

grant update (edited_at) on public.community_channel_messages to authenticated;
