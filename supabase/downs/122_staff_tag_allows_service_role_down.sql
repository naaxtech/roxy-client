-- Restores 121's guard, which also refuses the service role.
create or replace function public.profiles_guard_staff_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_tag is distinct from old.staff_tag and not public.is_roxy_staff() then
    raise exception 'Only Roxy staff can set a member tag'
      using errcode = '42501';
  end if;
  if new.staff_tag is distinct from old.staff_tag then
    new.staff_tag_set_by := auth.uid();
    new.staff_tag_set_at := now();
  else
    new.staff_tag_set_by := old.staff_tag_set_by;
    new.staff_tag_set_at := old.staff_tag_set_at;
  end if;
  return new;
end;
$$;
