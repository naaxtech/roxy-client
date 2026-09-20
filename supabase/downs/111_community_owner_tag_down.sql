-- Undoes 111_community_owner_tag.sql.

drop function if exists public.set_community_owner(uuid, boolean);
drop policy if exists coc_read_core on public.community_owner_changes;
drop table if exists public.community_owner_changes;
alter table public.profiles drop column if exists is_community_owner;
