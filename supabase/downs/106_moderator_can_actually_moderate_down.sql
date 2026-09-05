-- Undoes 106_moderator_can_actually_moderate.sql.
--
-- Restoring the biconditional CHECK will FAIL if any entry is currently hidden
-- while keeping its published_at — which is the state 106 exists to make
-- possible. Clear those first if you truly need the old constraint back.

drop trigger if exists archive_reviews_guard_status on public.archive_reviews;
drop function if exists public.archive_reviews_guard_status();

revoke update (status) on public.archive_reviews from authenticated;

revoke update on public.archive_entries from authenticated;
grant update on public.archive_entries to authenticated;

grant insert, update, delete on public.archive_entries to anon;
grant insert, update, delete on public.archive_reviews to anon;

alter table public.archive_entries
  drop constraint if exists archive_published_has_date;
alter table public.archive_entries
  add constraint archive_published_has_date
  check ((status = 'published') = (published_at is not null));
