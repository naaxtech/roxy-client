-- Undoes 121_staff_member_tags.sql.
--
-- Does NOT touch the seventeen member-writable columns: 121 never revoked them,
-- so there is nothing to restore, and re-granting a re-derived list is how that
-- set gets quietly replaced with a wrong one.

drop trigger if exists profiles_guard_staff_tag on public.profiles;
drop function if exists public.profiles_guard_staff_tag();

drop policy if exists "staff set member tags" on public.profiles;

revoke update (staff_tag, staff_tag_set_by, staff_tag_set_at) on public.profiles from authenticated;

drop index if exists public.profiles_leaderboard;

alter table public.profiles drop constraint if exists profiles_staff_tag_len;
alter table public.profiles
  drop column if exists staff_tag_set_at,
  drop column if exists staff_tag_set_by,
  drop column if exists staff_tag;
