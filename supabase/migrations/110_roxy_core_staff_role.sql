-- 110 — Roxy core vs staff
--
-- is_staff stays the gate every existing policy already reads
-- (is_roxy_staff). staff_role says which kind of staff: `staff` can
-- operate the host tools; `core` is Roxy HQ and can also mint or
-- revoke staff. Nobody can grant `core` from a client — those two
-- addresses are seeded here, the same way 084 seeded founding reviewers.
--
-- 080 never granted UPDATE on is_staff. This file does not add one.
-- Writes go through set_staff_role.

alter table public.profiles
  add column if not exists staff_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_staff_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_staff_role_check
      check (staff_role is null or staff_role in ('staff', 'core'));
  end if;
end
$$;

comment on column public.profiles.staff_role is
  'Which kind of Roxy operator: staff, core, or none. is_staff stays in sync. Clients cannot UPDATE this column.';

update public.profiles
set staff_role = 'staff'
where is_staff = true
  and staff_role is null;

update public.profiles p
set
  is_staff = true,
  staff_role = 'core'
from auth.users u
where p.id = u.id
  and lower(u.email) in (
    'naaxtech.official@gmail.com',
    'naaxtech.marketing@gmail.com'
  );

create or replace function public.is_roxy_core()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and staff_role = 'core'
  );
$$;

revoke all on function public.is_roxy_core() from public, anon;
grant execute on function public.is_roxy_core() to authenticated;

comment on function public.is_roxy_core() is
  'True only for seeded Roxy HQ accounts. Used by set_staff_role.';

create table if not exists public.staff_role_changes (
  id         bigserial   primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  old_role   text,
  new_role   text,
  changed_by uuid        references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists staff_role_changes_user
  on public.staff_role_changes (user_id, changed_at desc);

alter table public.staff_role_changes enable row level security;

drop policy if exists src_read_core on public.staff_role_changes;
create policy src_read_core on public.staff_role_changes
  for select to authenticated
  using (public.is_roxy_core());

create or replace function public.set_staff_role(
  p_user_id uuid,
  p_role    text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_old text;
  v_next text;
begin
  if not public.is_roxy_core() then
    raise exception 'not authorised to set staff role' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'cannot change your own staff role' using errcode = '42501';
  end if;

  if p_role is null or p_role = 'none' then
    v_next := null;
  elsif p_role = 'staff' then
    v_next := 'staff';
  else
    raise exception 'invalid staff role' using errcode = '22023';
  end if;

  select staff_role into v_old
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if v_old = 'core' then
    raise exception 'cannot change a core account' using errcode = '42501';
  end if;

  if v_old is not distinct from v_next then
    return;
  end if;

  update public.profiles
  set
    staff_role = v_next,
    is_staff = (v_next is not null)
  where id = p_user_id;

  insert into public.staff_role_changes (user_id, old_role, new_role, changed_by)
  values (p_user_id, v_old, v_next, auth.uid());
end;
$$;

revoke all on function public.set_staff_role(uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, text) to authenticated;

comment on function public.set_staff_role(uuid, text) is
  'Core-only write of profiles.staff_role / is_staff. Clients have no column UPDATE grant. Cannot mint core.';
