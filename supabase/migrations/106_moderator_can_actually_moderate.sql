-- 106 — A moderator could not moderate
--
-- Migration 100 exists to make two actions work: hide an entry, and remove a
-- review. It wrote the policies and stopped there. BOTH actions fail in
-- production, and each fails for a different reason. Verified by running them
-- as a real staff account against the live database:
--
--   update archive_reviews set status='removed'  -> 42501 permission denied
--   update archive_entries set status='hidden'   -> 23514 archive_published_has_date
--
-- On a safety product this is the most expensive class of defect there is: the
-- reporting queue fills up and every action offered against it is a no-op.
--
-- 100's own comment said "The policies below are scoped to the exact columns a
-- moderator touches." That was never true — RLS chooses ROWS and never columns,
-- which is the whole lesson of migration 101 — and `archive_entries` in fact
-- carried a table-WIDE update grant. This migration makes the sentence true.

-- ── 1. Hiding an entry must not destroy the date it was published ───────────
--
-- archive_published_has_date was a BICONDITIONAL:
--   CHECK ((status = 'published') = (published_at IS NOT NULL))
-- so a hidden entry was required to have a NULL published_at. Hiding therefore
-- meant erasing the publication date, and un-hiding could never restore it —
-- `staff-review-archive-revision` already carries a comment apologising for
-- clearing the column for exactly this reason.
--
-- The intent was "a published entry has a date". The converse — "an unpublished
-- entry must not have one" — is what breaks, and it buys nothing: a hidden
-- entry IS a formerly published one and its date is the fact worth keeping.

alter table public.archive_entries
  drop constraint if exists archive_published_has_date;

alter table public.archive_entries
  add constraint archive_published_has_date
  check (status <> 'published' or published_at is not null);

-- ── 2. A moderator can set a review's status ────────────────────────────────
--
-- archive_reviews_update_staff granted the ROW. `authenticated` held UPDATE on
-- (body, is_recommend, no_spoilers_ack, updated_at) and NOT on `status`, so the
-- policy admitted the row and the grant refused the column.

grant update (status) on public.archive_reviews to authenticated;

-- That grant alone would open a hole. `archive_reviews_update_own` is
-- USING (author_id = auth.uid()), and archive_reviews.status is
-- ('published','removed') — so an author could set her own REMOVED review back
-- to 'published' and undo the moderation. RLS cannot express "this column is
-- yours to read but not to change".
--
-- The trigger gates on OLD.status vs NEW.status. Reading only NEW would let the
-- caller choose which rule applies to her, which is the defect migration's
-- lesson about `new.doc_type` in the sibling repo.
create or replace function public.archive_reviews_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_roxy_staff() then
    raise exception 'Only staff can change a review''s status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists archive_reviews_guard_status on public.archive_reviews;
create trigger archive_reviews_guard_status
  before update on public.archive_reviews
  for each row
  execute function public.archive_reviews_guard_status();

-- ── 3. Make 100's promise true on archive_entries ──────────────────────────
--
-- The table-wide grant let anyone the staff policy admitted rewrite vote_count,
-- up_count, has_score, baseline_vote_count, slug and title by hand — around the
-- trigger that recomputes the counters from the votes themselves.
--
-- Safe to narrow, and checked before writing it:
--   * The mobile client only SELECTs from archive_entries; every write goes
--     through an edge function.
--   * Those edge functions run as service_role, which is not subject to grants.
--   * archive_refresh_vote_counts and archive_refresh_review_count are both
--     SECURITY DEFINER, so narrowing the caller's grant cannot break voting.

revoke update on public.archive_entries from authenticated;
grant update (status, published_at, updated_at) on public.archive_entries to authenticated;

-- anon has never had a policy admitting it to write anything here — every write
-- policy in this schema tests auth.uid(), which is NULL for anon — but a write
-- grant that only a missing policy stands between is one edit away from real.
revoke insert, update, delete on public.archive_entries from anon;
revoke insert, update, delete on public.archive_reviews from anon;
