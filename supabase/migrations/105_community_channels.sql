-- 105 — Community channels
--
-- The design gives a community a row of `# channel` buttons and a message list
-- (markup 655–697). Nothing in the schema could hold that.
--
-- WHY NOT `conversations`. That table decides who may read a thread by scanning
-- `participant_ids uuid[]`. Migration 103 fixed two bypasses that came straight
-- out of that shape: a null `conversation_type` that matched a permissive
-- branch, and a three-participant array carrying a decoy. A channel with 1,240
-- members would need 1,240 entries in that array and would force the DM
-- permission logic to special-case itself.
--
-- Channel access is a PROPERTY — "is she in this community" — so it is asked of
-- `community_members` through `is_community_member(cid)`, which is already
-- STABLE SECURITY DEFINER with a pinned search_path and already composes
-- `is_approved_member()`. Nothing here re-implements membership.

create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  -- The `#general` in the design's chip row. Lowercase, hyphenated, no '#':
  -- the sigil is presentation and storing it would put it in every URL.
  slug text not null,
  name text not null,
  topic text,
  -- Explicit ordering. Sorting by created_at would make the chip row reshuffle
  -- itself the moment a mod adds a channel.
  position integer not null default 0,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint community_channels_slug_shape
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  constraint community_channels_name_len
    check (char_length(name) between 1 and 40),
  constraint community_channels_topic_len
    check (topic is null or char_length(topic) <= 140),
  constraint community_channels_slug_unique
    unique (community_id, slug)
);

create table if not exists public.community_channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  -- Nullable so a deleted account does not take the conversation with it. The
  -- row survives as "removed"; the thread stays readable.
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete: a moderator removing a message must not punch a hole in a
  -- thread other people are replying to.
  deleted_at timestamptz,

  constraint community_channel_messages_body_len
    check (char_length(body) between 1 and 2000)
);

-- Every channel needs its own default. A partial unique index rather than a
-- constraint, because "at most one default per community" is only about the
-- rows where is_default is true.
create unique index if not exists community_channels_one_default
  on public.community_channels (community_id)
  where is_default;

create index if not exists community_channels_by_community
  on public.community_channels (community_id, position, created_at);

-- The list query is "this channel, newest last, undeleted". Ordering lives in
-- the index so a busy channel does not sort on every open.
create index if not exists community_channel_messages_by_channel
  on public.community_channel_messages (channel_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — in this file, not a later one. A table created without it is readable
-- by every authenticated user for exactly as long as the gap lasts.
-- ---------------------------------------------------------------------------

alter table public.community_channels enable row level security;
alter table public.community_channel_messages enable row level security;

-- Is she a moderator of THIS community? Same shape as is_community_member:
-- SECURITY DEFINER so the policy can read community_members without needing a
-- policy on it, STABLE so the planner may cache it per statement, and
-- search_path pinned so a schema on the caller's path cannot shadow a table.
create or replace function public.is_community_moderator(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_approved_member()
     and exists (
       select 1 from public.community_members
       where community_id = cid
         and user_id = auth.uid()
         -- Composed from the roles that HOLD the power, never by excluding
         -- 'member'. A fourth role added later would otherwise silently
         -- inherit moderation.
         and role in ('owner', 'admin', 'moderator')
     );
$$;

revoke all on function public.is_community_moderator(uuid) from public;
grant execute on function public.is_community_moderator(uuid) to authenticated;

-- Channels ------------------------------------------------------------------

drop policy if exists "members read their community's channels" on public.community_channels;
create policy "members read their community's channels"
  on public.community_channels for select to authenticated
  using (public.is_community_member(community_id));

drop policy if exists "moderators create channels" on public.community_channels;
create policy "moderators create channels"
  on public.community_channels for insert to authenticated
  with check (public.is_community_moderator(community_id));

drop policy if exists "moderators rename channels" on public.community_channels;
create policy "moderators rename channels"
  on public.community_channels for update to authenticated
  using (public.is_community_moderator(community_id))
  -- Both halves. USING alone decides which rows she may touch and would let a
  -- moderator move a channel into a community she does not moderate.
  with check (public.is_community_moderator(community_id));

drop policy if exists "moderators delete channels" on public.community_channels;
create policy "moderators delete channels"
  on public.community_channels for delete to authenticated
  using (public.is_community_moderator(community_id));

-- Messages ------------------------------------------------------------------

drop policy if exists "members read channel messages" on public.community_channel_messages;
create policy "members read channel messages"
  on public.community_channel_messages for select to authenticated
  using (
    exists (
      select 1 from public.community_channels c
      where c.id = channel_id
        and public.is_community_member(c.community_id)
    )
  );

drop policy if exists "members post as themselves" on public.community_channel_messages;
create policy "members post as themselves"
  on public.community_channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.community_channels c
      where c.id = channel_id
        and public.is_community_member(c.community_id)
    )
  );

drop policy if exists "authors edit their own message" on public.community_channel_messages;
create policy "authors edit their own message"
  on public.community_channel_messages for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "moderators moderate channel messages" on public.community_channel_messages;
create policy "moderators moderate channel messages"
  on public.community_channel_messages for update to authenticated
  using (
    exists (
      select 1 from public.community_channels c
      where c.id = channel_id
        and public.is_community_moderator(c.community_id)
    )
  )
  with check (
    exists (
      select 1 from public.community_channels c
      where c.id = channel_id
        and public.is_community_moderator(c.community_id)
    )
  );

-- No DELETE policy on messages, deliberately. Removal is `deleted_at`, so a
-- moderated message does not punch a hole in a thread people are replying to.

-- RLS chooses ROWS. It does not choose columns, and a member with UPDATE on her
-- own row could otherwise rewrite `created_at` to pin herself to the top of the
-- channel, or set `channel_id` to move her message into another one. Column
-- privileges are the separate grant that stops it.
revoke all on public.community_channel_messages from authenticated;
grant select, insert on public.community_channel_messages to authenticated;
grant update (body, edited_at, deleted_at) on public.community_channel_messages to authenticated;

revoke all on public.community_channels from authenticated;
grant select, insert, delete on public.community_channels to authenticated;
grant update (name, topic, position, is_default) on public.community_channels to authenticated;

-- Realtime: the client subscribes filtered by channel_id. Without the table in
-- the publication the filter matches nothing and the channel never updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_channel_messages'
  ) then
    alter publication supabase_realtime add table public.community_channel_messages;
  end if;
end $$;

-- Every existing community gets the channel the design opens on, so the screen
-- is never empty on a community that predates this migration.
insert into public.community_channels (community_id, slug, name, topic, position, is_default, created_by)
select c.id, 'general', 'general', 'Everything else.', 0, true, c.created_by
from public.communities c
on conflict (community_id, slug) do nothing;
