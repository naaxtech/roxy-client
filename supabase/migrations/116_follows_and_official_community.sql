-- 116 — Follows + official community grant
--
-- Phase 1 overlay. Posts already live on author_id when community_id is null
-- (composer + posts_select). This adds the missing subscription graph and the
-- one FK that makes "official community" a real grant instead of a boolean
-- that only opened chat.
--
-- Follow = posts in your feed. Join stays community_members.
-- Clients cannot UPDATE official_community_id (column is absent from the 080
-- UPDATE grant). Writes go through set_community_owner, same as the tag.

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follows_no_self check (follower_id <> followed_id)
);

create index if not exists follows_followed
  on public.follows (followed_id, created_at desc);

alter table public.follows enable row level security;

drop policy if exists follows_select_own on public.follows;
create policy follows_select_own on public.follows
  for select to authenticated
  using (
    public.is_approved_member()
    and (follower_id = auth.uid() or followed_id = auth.uid())
  );

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (
    public.is_approved_member()
    and follower_id = auth.uid()
    and follower_id <> followed_id
    and not public.blocked_pair(auth.uid(), followed_id)
  );

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

comment on table public.follows is
  'Feed subscription. Follow anyone; it never grants chat. Join stays community_members on an official community.';

alter table public.profiles
  add column if not exists official_community_id uuid references public.communities(id) on delete set null;

-- One official community per profile, and one profile per official community.
create unique index if not exists profiles_official_community_unique
  on public.profiles (official_community_id)
  where official_community_id is not null;

comment on column public.profiles.official_community_id is
  'Roxy-granted official community row used for join + chat only. Posts do not live here. Clients have no UPDATE grant.';

-- Granting true links or creates the community. Ungranting clears the FK and
-- does not delete the community or its members.
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
  v_official uuid;
  v_username text;
  v_display text;
  v_slug text;
  v_suffix text;
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

  select is_community_owner, staff_role, vetting_status,
         official_community_id, username, display_name
    into v_old, v_role, v_vetting, v_official, v_username, v_display
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

  if p_owner is true and v_official is null then
    v_slug := trim(both '-' from regexp_replace(
      lower(coalesce(nullif(btrim(v_username), ''), 'community')),
      '[^a-z0-9]+', '-', 'g'
    ));
    if v_slug is null or v_slug = '' then
      v_slug := 'community';
    end if;
    v_suffix := substr(replace(p_user_id::text, '-', ''), 1, 8);
    if exists (select 1 from public.communities c where c.slug = v_slug)
       or v_slug = 'roxy-official' then
      v_slug := left(v_slug, 20) || '-' || v_suffix;
    end if;

    insert into public.communities (name, slug, description, category, is_private, created_by)
    values (
      coalesce(nullif(btrim(v_display), ''), coalesce(v_username, 'Community')),
      v_slug,
      null,
      'interest',
      false,
      p_user_id
    )
    returning id into v_official;

    insert into public.community_members (community_id, user_id, role)
    values (v_official, p_user_id, 'admin')
    on conflict (community_id, user_id) do update set role = 'admin';

    insert into public.community_channels (community_id, slug, name, topic, position, is_default, created_by)
    values (v_official, 'general', 'general', 'Community chat.', 0, true, p_user_id)
    on conflict (community_id, slug) do nothing;
  end if;

  if p_owner is false then
    v_official := null;
  end if;

  if v_old is not distinct from p_owner
     and (
       select official_community_id from public.profiles where id = p_user_id
     ) is not distinct from v_official then
    return;
  end if;

  update public.profiles
  set is_community_owner = p_owner,
      official_community_id = v_official
  where id = p_user_id;

  if v_old is distinct from p_owner then
    insert into public.community_owner_changes (user_id, old_owner, new_owner, changed_by)
    values (p_user_id, v_old, p_owner, auth.uid());
  end if;
end;
$$;

revoke all on function public.set_community_owner(uuid, boolean) from public, anon;
grant execute on function public.set_community_owner(uuid, boolean) to authenticated;

comment on function public.set_community_owner(uuid, boolean) is
  'Core-only official grant. Sets is_community_owner and links or creates one communities row for join/chat. Clients have no column UPDATE grant. Approved members only; refuses staff and core.';
