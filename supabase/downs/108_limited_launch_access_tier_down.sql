-- Undoes 108_limited_launch_access_tier.sql.

drop trigger if exists trg_join_official_community on public.profiles;
drop function if exists public.join_official_community();

delete from public.community_members
where community_id in (select id from public.communities where slug = 'roxy-official');

delete from public.community_channels
where community_id in (select id from public.communities where slug = 'roxy-official');

delete from public.communities where slug = 'roxy-official';

alter table public.profiles drop constraint if exists profiles_access_tier_check;
alter table public.profiles drop column if exists access_tier;
