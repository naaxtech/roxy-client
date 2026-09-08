-- 122 — The staff-tag guard must not block the service role
--
-- 121's trigger refuses any change `is_roxy_staff()` does not recognise, and
-- that predicate reads `auth.uid()`. In a service-role or superuser session
-- there is no JWT, so `auth.uid()` is NULL, `is_roxy_staff()` is false, and the
-- trigger refuses a backfill, a migration and any future edge function.
--
-- That protects nothing. Anyone holding the service-role key already has
-- unrestricted access to this database; the trigger is not what stands between
-- them and the table. All the refusal did was make legitimate admin work
-- impossible while leaving the actual threat model unchanged.
--
-- Allowing a NULL `auth.uid()` does NOT open a member path. The policies still
-- apply to `authenticated`: a member reaches her own row through
-- `profiles_update_own`, which is USING (auth.uid() = id) — with a NULL uid
-- that matches nothing at all. The trigger's job is to catch the case where she
-- IS on her own row, and that case always has a uid.

create or replace function public.profiles_guard_staff_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_tag is distinct from old.staff_tag
     and auth.uid() is not null
     and not public.is_roxy_staff() then
    raise exception 'Only Roxy staff can set a member tag'
      using errcode = '42501';
  end if;

  -- Provenance is still written by the database and never accepted from the
  -- caller. A service-role write leaves it NULL rather than crediting nobody in
  -- particular — "set by the system" is the honest record of what happened.
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
