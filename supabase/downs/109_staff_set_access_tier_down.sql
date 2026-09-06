-- Undoes 109_staff_set_access_tier.sql.

drop function if exists public.set_access_tier(uuid, text);
drop policy if exists atc_read_staff on public.access_tier_changes;
drop table if exists public.access_tier_changes;
drop policy if exists profiles_select_staff on public.profiles;
