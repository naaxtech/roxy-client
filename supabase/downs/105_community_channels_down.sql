-- Undoes 105_community_channels.sql.

-- Out of the publication before the table goes, or the drop fails on the
-- dependency.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_channel_messages'
  ) then
    alter publication supabase_realtime drop table public.community_channel_messages;
  end if;
end $$;

drop table if exists public.community_channel_messages;
drop table if exists public.community_channels;

drop function if exists public.is_community_moderator(uuid);
