-- 109 — Staff path for the limited-launch toggle
--
-- 108 added `profiles.access_tier` and left it unwritable from the client,
-- on purpose: 080 revoked column UPDATE and never granted this one. A staff
-- member in Studio still has to tag testers, so this file is the single
-- audited write path — the same shape as `set_community_role` (078) and
-- `decide_application` (071).
--
-- Community admins do not get this. Opening the full app is a product
-- decision, not a community role.

-- Staff must be able to see every profile to tag it. profiles_select_public
-- hides ghosts and inactive rows; those accounts still have an access_tier.
drop policy if exists profiles_select_staff on public.profiles;
create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (public.is_roxy_staff());

comment on policy profiles_select_staff on public.profiles is
  'Staff roster for launch access. Does not grant UPDATE; writes go through set_access_tier.';

create table if not exists public.access_tier_changes (
  id         bigserial   primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  old_tier   text,
  new_tier   text        not null check (new_tier in ('public', 'beta')),
  changed_by uuid        references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists access_tier_changes_user
  on public.access_tier_changes (user_id, changed_at desc);

alter table public.access_tier_changes enable row level security;

drop policy if exists atc_read_staff on public.access_tier_changes;
create policy atc_read_staff on public.access_tier_changes
  for select to authenticated
  using (public.is_roxy_staff());

create or replace function public.set_access_tier(
  p_user_id uuid,
  p_tier    text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to set access tier' using errcode = '42501';
  end if;

  if p_tier is null or p_tier not in ('public', 'beta') then
    raise exception 'invalid access tier' using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  select access_tier into v_old
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if v_old is not distinct from p_tier then
    return;
  end if;

  update public.profiles
  set access_tier = p_tier
  where id = p_user_id;

  insert into public.access_tier_changes (user_id, old_tier, new_tier, changed_by)
  values (p_user_id, v_old, p_tier, auth.uid());
end;
$$;

revoke all on function public.set_access_tier(uuid, text) from public, anon;
grant execute on function public.set_access_tier(uuid, text) to authenticated;

comment on function public.set_access_tier(uuid, text) is
  'Staff-only write of profiles.access_tier. Clients have no column UPDATE grant.';
