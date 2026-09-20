-- 113 — Staff and core manage the Archive catalogue
--
-- 106 let a moderator hide an entry (status + published_at). It deliberately
-- revoked every other UPDATE column so vote_count could not be rewritten by
-- hand. The catalogue itself — title, summary, cover, a new row, a delete —
-- still had no staff path. Members propose; staff only decide those proposals.
--
-- Roxy staff and Roxy core own the Archive. Writes stay on SECURITY DEFINER
-- RPCs so the vote counters stay off-limits. Delete is its own function and
-- requires the live title, a fixed phrase, and a written reason. Hiding stays
-- the reversible action.

-- ── Audit ───────────────────────────────────────────────────────────────────
create table if not exists public.archive_entry_changes (
  id          bigserial primary key,
  entry_id    uuid,
  action      text not null check (action in ('create', 'update', 'delete')),
  snapshot    jsonb not null default '{}'::jsonb,
  reason      text,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index if not exists archive_entry_changes_entry
  on public.archive_entry_changes (entry_id, changed_at desc);

alter table public.archive_entry_changes enable row level security;

drop policy if exists aec_read_staff on public.archive_entry_changes;
create policy aec_read_staff on public.archive_entry_changes
  for select to authenticated
  using (public.is_roxy_staff());

comment on table public.archive_entry_changes is
  'Staff/core catalogue writes. Delete rows keep the last snapshot after the entry is gone.';

grant select on public.archive_entry_changes to authenticated;
revoke insert, update, delete on public.archive_entry_changes from authenticated, anon;

-- ── Extra stills. cover_url on the entry remains the hero the app shows. ────
create table if not exists public.archive_entry_photos (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.archive_entries(id) on delete cascade,
  url         text not null check (length(btrim(url)) between 8 and 500),
  position    integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists archive_entry_photos_entry
  on public.archive_entry_photos (entry_id, position, created_at);

alter table public.archive_entry_photos enable row level security;

drop policy if exists aep_read_published on public.archive_entry_photos;
create policy aep_read_published on public.archive_entry_photos
  for select to authenticated
  using (
    public.is_roxy_staff()
    or exists (
      select 1 from public.archive_entries e
      where e.id = archive_entry_photos.entry_id
        and e.status = 'published'
    )
  );

comment on table public.archive_entry_photos is
  'Staff-managed stills for an Archive entry. The hero is archive_entries.cover_url.';

grant select on public.archive_entry_photos to authenticated;
revoke insert, update, delete on public.archive_entry_photos from authenticated, anon;

-- ── Cover uploads ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('archive-covers', 'archive-covers', true)
on conflict (id) do nothing;

drop policy if exists archive_covers_read on storage.objects;
create policy archive_covers_read on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'archive-covers');

drop policy if exists archive_covers_insert on storage.objects;
create policy archive_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'archive-covers' and public.is_roxy_staff());

drop policy if exists archive_covers_update on storage.objects;
create policy archive_covers_update on storage.objects
  for update to authenticated
  using (bucket_id = 'archive-covers' and public.is_roxy_staff())
  with check (bucket_id = 'archive-covers' and public.is_roxy_staff());

drop policy if exists archive_covers_delete on storage.objects;
create policy archive_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'archive-covers' and public.is_roxy_staff());

-- ── Slug helper ─────────────────────────────────────────────────────────────
create or replace function public.archive_slugify(p_title text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := lower(coalesce(p_title, ''));
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  if length(v) > 80 then
    v := left(v, 80);
    v := trim(both '-' from v);
  end if;
  if v = '' then
    return 'entry';
  end if;
  return v;
end;
$$;

revoke all on function public.archive_slugify(text) from public, anon;
grant execute on function public.archive_slugify(text) to authenticated;

-- ── Save (create or update) ─────────────────────────────────────────────────
create or replace function public.staff_save_archive_entry(
  p_id             uuid,
  p_title          text,
  p_media_type     public.archive_media_type,
  p_release_year   integer,
  p_creator        text,
  p_length_label   text,
  p_summary        text,
  p_cover_url      text,
  p_cover_gradient text,
  p_external_ids   jsonb,
  p_status         public.archive_status,
  p_slug           text
)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_id uuid;
  v_slug text;
  v_base text;
  v_action text;
  v_existing public.archive_entries%rowtype;
  v_n int;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to manage archive entries' using errcode = '42501';
  end if;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 200 then
    raise exception 'title must be 1-200 characters' using errcode = '22023';
  end if;

  if p_media_type is null then
    raise exception 'media type is required' using errcode = '22023';
  end if;

  if p_release_year is not null and (p_release_year < 1800 or p_release_year > 2200) then
    raise exception 'release year must be between 1800 and 2200' using errcode = '22023';
  end if;

  if p_summary is not null and length(p_summary) > 400 then
    raise exception 'summary must be 400 characters or fewer' using errcode = '22023';
  end if;

  if p_cover_url is not null and length(p_cover_url) > 500 then
    raise exception 'cover url is too long' using errcode = '22023';
  end if;

  if p_status is null then
    raise exception 'status is required' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.archive_entries where id = p_id;
    if not found then
      raise exception 'entry not found' using errcode = 'P0002';
    end if;
  end if;

  if p_slug is not null and length(btrim(p_slug)) > 0 then
    v_slug := public.archive_slugify(p_slug);
  elsif p_id is null then
    v_slug := public.archive_slugify(p_title);
  else
    v_slug := v_existing.slug;
  end if;

  if p_id is null or v_slug is distinct from v_existing.slug then
    v_base := v_slug;
    v_n := 0;
    while exists (
      select 1 from public.archive_entries e
      where e.slug = v_slug
        and (p_id is null or e.id <> p_id)
    ) loop
      v_n := v_n + 1;
      v_slug := left(v_base, 72) || '-' || v_n::text;
    end loop;
  end if;

  if p_id is null then
    v_action := 'create';
    insert into public.archive_entries (
      slug, title, media_type, release_year, creator, length_label,
      summary, cover_url, cover_gradient, external_ids, status,
      created_by, published_at
    ) values (
      v_slug,
      btrim(p_title),
      p_media_type,
      p_release_year,
      nullif(btrim(coalesce(p_creator, '')), ''),
      nullif(btrim(coalesce(p_length_label, '')), ''),
      nullif(p_summary, ''),
      nullif(btrim(coalesce(p_cover_url, '')), ''),
      nullif(btrim(coalesce(p_cover_gradient, '')), ''),
      coalesce(p_external_ids, '{}'::jsonb),
      p_status,
      auth.uid(),
      case when p_status = 'published' then now() else null end
    )
    returning id into v_id;
  else
    v_action := 'update';
    v_id := p_id;
    update public.archive_entries set
      slug           = v_slug,
      title          = btrim(p_title),
      media_type     = p_media_type,
      release_year   = p_release_year,
      creator        = nullif(btrim(coalesce(p_creator, '')), ''),
      length_label   = nullif(btrim(coalesce(p_length_label, '')), ''),
      summary        = nullif(p_summary, ''),
      cover_url      = nullif(btrim(coalesce(p_cover_url, '')), ''),
      cover_gradient = nullif(btrim(coalesce(p_cover_gradient, '')), ''),
      external_ids   = coalesce(p_external_ids, external_ids),
      status         = p_status,
      published_at   = case
        when p_status = 'published' and published_at is null then now()
        else published_at
      end,
      updated_at     = now()
    where id = p_id;
  end if;

  insert into public.archive_entry_changes (entry_id, action, snapshot, changed_by)
  values (
    v_id,
    v_action,
    jsonb_build_object(
      'title', btrim(p_title),
      'slug', v_slug,
      'media_type', p_media_type,
      'status', p_status
    ),
    auth.uid()
  );

  return v_id;
end;
$$;

revoke all on function public.staff_save_archive_entry(
  uuid, text, public.archive_media_type, integer, text, text, text, text, text, jsonb, public.archive_status, text
) from public, anon;
grant execute on function public.staff_save_archive_entry(
  uuid, text, public.archive_media_type, integer, text, text, text, text, text, jsonb, public.archive_status, text
) to authenticated;

comment on function public.staff_save_archive_entry(
  uuid, text, public.archive_media_type, integer, text, text, text, text, text, jsonb, public.archive_status, text
) is
  'Staff/core create or edit an Archive entry. Vote counters are not writable here.';

-- ── Photos ──────────────────────────────────────────────────────────────────
create or replace function public.staff_add_archive_photo(
  p_entry_id uuid,
  p_url      text
)
returns uuid
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_id uuid;
  v_count int;
  v_pos int;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to manage archive entries' using errcode = '42501';
  end if;

  if p_entry_id is null or p_url is null or length(btrim(p_url)) < 8 or length(p_url) > 500 then
    raise exception 'photo url is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.archive_entries where id = p_entry_id) then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;

  select count(*) into v_count from public.archive_entry_photos where entry_id = p_entry_id;
  if v_count >= 8 then
    raise exception 'an entry can hold at most 8 photos' using errcode = '22023';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.archive_entry_photos
  where entry_id = p_entry_id;

  insert into public.archive_entry_photos (entry_id, url, position, created_by)
  values (p_entry_id, btrim(p_url), v_pos, auth.uid())
  returning id into v_id;

  if v_count = 0 then
    update public.archive_entries
    set cover_url = btrim(p_url), updated_at = now()
    where id = p_entry_id and cover_url is null;
  end if;

  return v_id;
end;
$$;

revoke all on function public.staff_add_archive_photo(uuid, text) from public, anon;
grant execute on function public.staff_add_archive_photo(uuid, text) to authenticated;

create or replace function public.staff_remove_archive_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_entry uuid;
  v_url text;
  v_cover text;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to manage archive entries' using errcode = '42501';
  end if;

  select entry_id, url into v_entry, v_url
  from public.archive_entry_photos
  where id = p_photo_id;

  if v_entry is null then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;

  delete from public.archive_entry_photos where id = p_photo_id;

  select cover_url into v_cover from public.archive_entries where id = v_entry;
  if v_cover is not distinct from v_url then
    update public.archive_entries
    set cover_url = (
      select url from public.archive_entry_photos
      where entry_id = v_entry
      order by position, created_at
      limit 1
    ),
    updated_at = now()
    where id = v_entry;
  end if;
end;
$$;

revoke all on function public.staff_remove_archive_photo(uuid) from public, anon;
grant execute on function public.staff_remove_archive_photo(uuid) to authenticated;

create or replace function public.staff_set_archive_cover(
  p_entry_id uuid,
  p_photo_id uuid
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_url text;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to manage archive entries' using errcode = '42501';
  end if;

  select url into v_url
  from public.archive_entry_photos
  where id = p_photo_id and entry_id = p_entry_id;

  if v_url is null then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;

  update public.archive_entries
  set cover_url = v_url, updated_at = now()
  where id = p_entry_id;
end;
$$;

revoke all on function public.staff_set_archive_cover(uuid, uuid) from public, anon;
grant execute on function public.staff_set_archive_cover(uuid, uuid) to authenticated;

-- ── Hard delete. Three gates, all server-side. ──────────────────────────────
create or replace function public.staff_delete_archive_entry(
  p_id            uuid,
  p_confirm_title text,
  p_confirm_phrase text,
  p_reason        text
)
returns void
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_row public.archive_entries%rowtype;
begin
  if not public.is_roxy_staff() then
    raise exception 'not authorised to manage archive entries' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'entry id is required' using errcode = '22023';
  end if;

  select * into v_row from public.archive_entries where id = p_id;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;

  if p_confirm_title is null or btrim(p_confirm_title) is distinct from v_row.title then
    raise exception 'type the entry title exactly to delete it' using errcode = '22023';
  end if;

  if p_confirm_phrase is distinct from 'DELETE THIS ENTRY' then
    raise exception 'type DELETE THIS ENTRY to confirm' using errcode = '22023';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 24 then
    raise exception 'a deletion needs a reason of at least 24 characters' using errcode = '22023';
  end if;

  insert into public.archive_entry_changes (entry_id, action, snapshot, reason, changed_by)
  values (
    v_row.id,
    'delete',
    jsonb_build_object(
      'title', v_row.title,
      'slug', v_row.slug,
      'media_type', v_row.media_type,
      'status', v_row.status,
      'cover_url', v_row.cover_url,
      'summary', v_row.summary
    ),
    btrim(p_reason),
    auth.uid()
  );

  delete from public.archive_entries where id = p_id;
end;
$$;

revoke all on function public.staff_delete_archive_entry(uuid, text, text, text) from public, anon;
grant execute on function public.staff_delete_archive_entry(uuid, text, text, text) to authenticated;

comment on function public.staff_delete_archive_entry(uuid, text, text, text) is
  'Permanently deletes an Archive entry. Requires the live title, the phrase DELETE THIS ENTRY, and a 24-character reason. Votes, reviews, notes and watchlist rows cascade with it.';
