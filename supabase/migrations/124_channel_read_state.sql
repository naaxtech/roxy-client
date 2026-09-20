-- 124 — Community channel unread (read cursors)
--
-- DMs track read via messages.is_read + mark_conversation_read (085). Channel
-- messages had no equivalent, so the inbox's COMMUNITY CHATS section always
-- rendered a zero unread badge — a member could not tell where a group was
-- active. This adds a per-(member, channel) read cursor and the two functions
-- that read and write it.
--
-- WHY a cursor table and not is_read on messages.
--    A group message is read by many people; one boolean cannot say "read BY
--    WHOM". A cursor per member is the shape every chat app uses, and it is one
--    row per member per channel, not one per message.
--
-- Baseline is joined_at, not epoch. A member who joins a community with two
-- years of history must not be told she has 14,000 unread messages; she is
-- caught up to the moment she joined. Only messages after that — or after her
-- last explicit mark_channel_read — count.

create table if not exists public.community_channel_read_state (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  channel_id   uuid not null references public.community_channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (profile_id, channel_id)
);

alter table public.community_channel_read_state enable row level security;

-- A cursor is private: it says what one member has seen.
drop policy if exists "channel_read_state_own" on public.community_channel_read_state;
create policy "channel_read_state_own"
  on public.community_channel_read_state for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Mark a channel read. SECURITY DEFINER so it can verify the caller is a member
-- of the channel's community itself; EXECUTE granted to authenticated only.
create or replace function public.mark_channel_read(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.community_channels c
    where c.id = p_channel_id
      and public.is_community_member(c.community_id)
  ) then
    raise exception 'channel not found' using errcode = 'P0002';
  end if;

  insert into public.community_channel_read_state (profile_id, channel_id, last_read_at)
  values (auth.uid(), p_channel_id, now())
  on conflict (profile_id, channel_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.mark_channel_read(uuid) from public, anon;
grant execute on function public.mark_channel_read(uuid) to authenticated;

-- Unread counts per community, for the inbox. The join on community_members
-- scopes the result to communities the CALLER belongs to; a community id she
-- names that she is not a member of produces no row. A count is not message
-- content, so plain membership is the right gate here (read access to the
-- messages themselves is still is_community_member, via 105).
create or replace function public.community_channel_unread(p_community_ids uuid[])
returns table (community_id uuid, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.community_id, count(m.id)
  from public.community_channels c
  join public.community_members cm
    on cm.community_id = c.community_id and cm.user_id = auth.uid()
  join public.community_channel_messages m on m.channel_id = c.id
  left join public.community_channel_read_state r
    on r.channel_id = c.id and r.profile_id = auth.uid()
  where c.community_id = any (p_community_ids)
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > coalesce(r.last_read_at, cm.joined_at)
  group by c.community_id;
$$;

revoke all on function public.community_channel_unread(uuid[]) from public, anon;
grant execute on function public.community_channel_unread(uuid[]) to authenticated;
