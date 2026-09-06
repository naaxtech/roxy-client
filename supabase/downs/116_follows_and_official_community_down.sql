-- Undoes 116_follows_and_official_community.sql.
-- Restores set_community_owner to the 111 body (tag only, no official FK).

drop table if exists public.follows;

alter table public.profiles drop column if exists official_community_id;

create or replace function public.set_community_owner(
  p_user_id uuid,
  p_owner   boolean
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_old boolean;
  v_role text;
  v_vetting text;
begin
  if not public.is_roxy_core() then
    raise exception 'not authorised to set community owner' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  if p_owner is null then
    raise exception 'owner flag is required' using errcode = '22023';
  end if;

  select is_community_owner, staff_role, vetting_status
    into v_old, v_role, v_vetting
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if v_role = 'core' then
    raise exception 'cannot tag a core account' using errcode = '42501';
  end if;

  if v_role = 'staff' then
    raise exception 'cannot tag staff' using errcode = '42501';
  end if;

  if p_owner is true and v_vetting is distinct from 'approved' then
    raise exception 'only approved members can be community owners' using errcode = '42501';
  end if;

  if v_old is not distinct from p_owner then
    return;
  end if;

  update public.profiles
  set is_community_owner = p_owner
  where id = p_user_id;

  insert into public.community_owner_changes (user_id, old_owner, new_owner, changed_by)
  values (p_user_id, v_old, p_owner, auth.uid());
end;
$$;
