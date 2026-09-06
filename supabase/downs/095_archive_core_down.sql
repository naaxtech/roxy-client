-- ============================================================
-- 095_archive_core_down.sql
--
-- Drops the Archive entirely.
--
-- This DESTROYS every score, review, content note and watchlist the community
-- built. There is no soft version of it: the counts are denormalized onto the
-- entries, so dropping the entries takes the votes with them by cascade.
-- Take a dump first, or do not run this.
--
-- Nothing here touches profiles. The Archive deliberately added no membership
-- column — it reads profiles.vetting_status, which 070 owns.
-- ============================================================

DROP TABLE IF EXISTS public.archive_revisions;
DROP TABLE IF EXISTS public.archive_watchlist;
DROP TABLE IF EXISTS public.archive_note_agreements;
DROP TABLE IF EXISTS public.archive_content_notes;
DROP TABLE IF EXISTS public.archive_review_helpful;
DROP TABLE IF EXISTS public.archive_reviews;
DROP TABLE IF EXISTS public.archive_votes;
DROP TABLE IF EXISTS public.archive_entries;

DROP TYPE IF EXISTS public.archive_revision_status;
DROP TYPE IF EXISTS public.archive_revision_kind;
DROP TYPE IF EXISTS public.archive_status;
DROP TYPE IF EXISTS public.archive_media_type;
