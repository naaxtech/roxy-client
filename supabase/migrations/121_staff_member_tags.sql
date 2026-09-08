-- 121 — Staff-assigned member tags
--
-- Discover's Top 10 becomes people rather than communities, and each woman on
-- it carries a short tag the Roxy team assigns from Studio: "Archivist",
-- "Community builder", "Host of the year". Editorial, not earned — a badge is
-- what the product awards; this is what the team says about someone.
--
-- THE WHOLE POINT IS THAT SHE CANNOT WRITE IT HERSELF. A tag a member can set
-- is a bio field with extra steps; its entire value is that it came from the
-- team. So enforcement takes both halves, and this codebase has paid for
-- learning that twice (101, then again in 106):
--
--   * a policy, so staff may update a row that is not their own; and
--   * the COLUMN not being in the member grant, because RLS chooses ROWS and
--     never columns — `profiles_update_own` is USING (auth.uid() = id), so a
--     member is already allowed to update her own row.
--
-- `profiles` is already column-scoped: `authenticated` holds UPDATE on exactly
-- seventeen columns, and is_staff, access_tier, vetting_status and
-- gamification_points are correctly absent. Nothing here revokes or re-grants
-- that set — replacing a careful list with a re-derived one is how a member
-- loses the ability to edit her own bio.

alter table public.profiles
  add column if not exists staff_tag text,
  add column if not exists staff_tag_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists staff_tag_set_at timestamptz;

-- Short enough to sit under a name on a poster card. A tag that wraps to three
-- lines is a bio, and this is not a bio.
alter table public.profiles
  drop constraint if exists profiles_staff_tag_len;
alter table public.profiles
  add constraint profiles_staff_tag_len
  check (staff_tag is null or char_length(btrim(staff_tag)) between 2 and 24);

-- The Top 10 reads points then name. The index carries that order so a
-- leaderboard over a growing member table does not sort the whole table.
create index if not exists profiles_leaderboard
  on public.profiles (gamification_points desc, display_name)
  where vetting_status in ('approved', 'unvetted');

-- ── Only staff may write it ────────────────────────────────────────────────
--
-- The three new columns are deliberately NOT granted to `authenticated`. They
-- are simply absent from the seventeen, which is what stops a member setting
-- her own tag on the row she is otherwise allowed to update.
--
-- Staff act through the same `authenticated` role, so they need the grant —
-- and a grant is role-wide, since Postgres cannot scope one per policy. The
-- trigger below is therefore the thing that actually separates staff from
-- everyone else, exactly as it did for review status in 106.
grant update (staff_tag, staff_tag_set_by, staff_tag_set_at) on public.profiles to authenticated;

drop policy if exists "staff set member tags" on public.profiles;
create policy "staff set member tags"
  on public.profiles for update to authenticated
  using (public.is_roxy_staff())
  -- Both halves: USING alone decides which rows may be touched and would let a
  -- staff account move a tag onto a row it was never allowed to read.
  with check (public.is_roxy_staff());

create or replace function public.profiles_guard_staff_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Gated on OLD vs NEW, never on NEW alone: reading only the new row lets the
  -- caller choose which rule applies to her.
  if new.staff_tag is distinct from old.staff_tag and not public.is_roxy_staff() then
    raise exception 'Only Roxy staff can set a member tag'
      using errcode = '42501';
  end if;

  -- Provenance is written by the database, never accepted from the caller: a
  -- client that supplies its own "set by" can name anybody.
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

drop trigger if exists profiles_guard_staff_tag on public.profiles;
create trigger profiles_guard_staff_tag
  before update on public.profiles
  for each row
  execute function public.profiles_guard_staff_tag();
