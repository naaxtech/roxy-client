-- Undoes 110_roxy_core_staff_role.sql.

drop function if exists public.set_staff_role(uuid, text);
drop policy if exists src_read_core on public.staff_role_changes;
drop table if exists public.staff_role_changes;
drop function if exists public.is_roxy_core();

alter table public.profiles drop constraint if exists profiles_staff_role_check;
alter table public.profiles drop column if exists staff_role;
