-- 108 — Limited launch toggle + Roxy Official community
--
-- Public members may use the WLW Archive and the official community chat.
-- Everyone else of the product stays behind Coming soon until a profile is
-- tagged `access_tier = 'beta'`.
--
-- Default is public. Existing testers are NOT flipped to beta here — that
-- is a deliberate tag, not a grandfather.

alter table public.profiles
  add column if not exists access_tier text not null default 'public';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_access_tier_check'
  ) then
    alter table public.profiles
      add constraint profiles_access_tier_check
      check (access_tier in ('public', 'beta'));
  end if;
end $$;

comment on column public.profiles.access_tier is
  'Launch toggle. public = Archive + Roxy Official chat. beta = full app.';

-- Official community the limited launch opens into.
insert into public.communities (name, slug, description, category, is_private)
values (
  'Roxy Official',
  'roxy-official',
  'News, updates and chat with the Roxy team.',
  'support',
  false
)
on conflict (slug) do nothing;

-- Default #general so the chat screen is never empty on a community
-- created after 105's one-time backfill.
insert into public.community_channels (community_id, slug, name, topic, position, is_default)
select c.id, 'general', 'general', 'Official updates and chat.', 0, true
from public.communities c
where c.slug = 'roxy-official'
on conflict (community_id, slug) do nothing;

-- Every existing profile can open the official chat without a join tap.
insert into public.community_members (community_id, user_id, role)
select c.id, p.id, 'member'
from public.communities c
cross join public.profiles p
where c.slug = 'roxy-official'
on conflict (community_id, user_id) do nothing;

-- New profiles join the same way. SECURITY DEFINER so the insert is not
-- subject to the member's own RLS on community_members at create time.
create or replace function public.join_official_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  select id into cid from public.communities where slug = 'roxy-official';
  if cid is not null then
    insert into public.community_members (community_id, user_id, role)
    values (cid, new.id, 'member')
    on conflict (community_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_join_official_community on public.profiles;
create trigger trg_join_official_community
  after insert on public.profiles
  for each row execute function public.join_official_community();
