-- 111 — Community owner tag
--
-- An approved member may be tagged as a community owner by Roxy core.
-- That tag opens community chat for her (Official plus other communities).
-- It is never self-serve. Staff and core cannot be tagged. Pending
-- applicants cannot be tagged. Clients have no UPDATE grant — writes
-- go through set_community_owner, the same shape as set_staff_role.

alter table public.profiles
  add column if not exists is_community_owner boolean not null default false;

comment on column public.profiles.is_community_owner is
  'Core-tagged community owner. Opens community chat for an approved member. Clients cannot UPDATE this column.';

create table if not exists public.community_owner_changes (
  id         bigserial   primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  old_owner  boolean     not null,
  new_owner  boolean     not null,
  changed_by uuid        references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists community_owner_changes_user
  on public.community_owner_changes (user_id, changed_at desc);

alter table public.community_owner_changes enable row level security;

drop policy if exists coc_read_core on public.community_owner_changes;
create policy coc_read_core on public.community_owner_changes
  for select to authenticated
  using (public.is_roxy_core());

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

revoke all on function public.set_community_owner(uuid, boolean) from public, anon;
grant execute on function public.set_community_owner(uuid, boolean) to authenticated;

comment on function public.set_community_owner(uuid, boolean) is
  'Core-only write of profiles.is_community_owner. Clients have no column UPDATE grant. Approved members only; refuses staff and core.';
