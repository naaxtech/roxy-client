-- ============================================================
-- 095_archive_core.sql
--
-- The WLW Archive: a community-scored database of wlw films, TV, books, comics
-- and music. One entry table with a media_type, not five tables.
--
-- ── TWO DEVIATIONS FROM THE BRIEF, both because the brief was written against
--    an older snapshot of this repo. ───────────────────────────────────────
--
-- 1. NUMBERED 095, NOT 060. The brief says "continue the sequence from 059_".
--    HEAD is 094. 060-064 are long since taken.
--
-- 2. NO `profiles.membership_status`. The brief asks for a new enum column
--    ('pending','approved','rejected') with a backfill. That column already
--    exists under another name and is already load-bearing:
--    `profiles.vetting_status` (070_invite_gate_core), values
--    ('unvetted','pending','approved','rejected'), with the grandfather
--    backfill done by 072 and the reviewer-separated decision RPC
--    (`decide_application`) built in 071. Adding a second membership column
--    would be two stores of one truth, and this codebase has already shipped
--    that bug: `block_user` wrote a status nothing read, so the app told women
--    they were protected when they were not.
--
--    So the Archive reads the gate that exists. Write access uses
--    `is_approved_member()` (072), which is `vetting_status IN
--    ('approved','unvetted')` — composed from the states it PERMITS, never as
--    "not pending". Narrowing it to 'approved' alone would lock out every
--    pre-gate account in production, which is the exact bug 072's own comment
--    warns about.
--
-- ── WHY THIS FEATURE EXISTS, in this schema's own history ────────────────────
--    079_restore_vetting_default is a postmortem: a new signup landed on
--    vetting_status='pending', every RLS helper returned false, and she was
--    locked out of the whole app with no screen to explain it. The Archive is
--    the answer to that. A pending member can browse it, search it, read every
--    review and cast a score — and cannot write reviews, add entries or suggest
--    edits. It gives the waiting room something to be.
--
-- ── THE VOTE GATE IS IN THE SCHEMA, not only in the client ───────────────────
--    An entry shows a number only at >= 10 votes. That rule has to hold in the
--    ORDER BY as well as in the label, or "Top rated" leads with a single
--    person's opinion at 100%. `has_score` is a stored generated column so the
--    index and the client agree by construction;
--    apps/mobile/__tests__/lib/archiveScore.test.ts reads the threshold out of
--    this file and fails if the two drift.
-- ============================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.archive_media_type AS ENUM ('film', 'tv', 'book', 'comic', 'music');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.archive_status AS ENUM ('published', 'pending', 'rejected', 'hidden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.archive_revision_kind AS ENUM ('create', 'edit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.archive_revision_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Entries ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.archive_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  media_type     public.archive_media_type NOT NULL,
  release_year   integer CHECK (release_year BETWEEN 1800 AND 2200),
  -- Director, author, artist, showrunner. One column, because the Archive
  -- never needs to ask "which kind of maker is this" to render a row.
  creator        text,
  -- "2h 2m" | "848 pages" | "12 tracks". A label, not a number: the five media
  -- types do not share a unit, and inventing one would make it lie for four of
  -- them.
  length_label   text,
  -- Spoiler-free by policy. 200 is a soft cap in the composer and a hard one
  -- here, because "soft cap" enforced nowhere is no cap.
  summary        text CHECK (summary IS NULL OR length(summary) <= 400),
  cover_url      text,
  -- The prototype draws a gradient when there is no cover, and most entries
  -- will have no cover for a long time. Storing it makes the fallback stable
  -- per entry instead of reshuffling on every render.
  cover_gradient text,
  external_ids   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         public.archive_status NOT NULL DEFAULT 'pending',
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at   timestamptz,

  -- Trigger-maintained in 097. Denormalized because every row in the browse
  -- list needs them and a count(*) per row per render is the query that kills
  -- this screen.
  vote_count     integer NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  up_count       integer NOT NULL DEFAULT 0 CHECK (up_count >= 0),
  review_count   integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),

  -- Seeded demo weight, added to the real tallies by the trigger in 097.
  --
  -- Without this, seeding is a trap with a fuse on it: the counters are
  -- RECOMPUTED from archive_votes, so the first woman to vote on an entry
  -- showing 1,489 votes would collapse it to 1 — live, during the demo the
  -- seed exists for. Keeping the fabricated weight in its own column means the
  -- real votes are simply added to it and nothing a member does can erase it.
  --
  -- 098 sets these ONLY on a database that has the dev seed profiles. A
  -- production Archive starts every entry at zero and says "NEW · 0 votes"
  -- until real women vote, which is the only honest thing for it to say.
  baseline_vote_count integer NOT NULL DEFAULT 0 CHECK (baseline_vote_count >= 0),
  baseline_up_count   integer NOT NULL DEFAULT 0 CHECK (baseline_up_count >= 0),

  -- The >= 10 rule, in the schema. See the header.
  has_score      boolean GENERATED ALWAYS AS (vote_count >= 10) STORED,

  search_tsv     tsvector,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT archive_up_not_above_total CHECK (up_count <= vote_count),
  CONSTRAINT archive_baseline_up_not_above_total
    CHECK (baseline_up_count <= baseline_vote_count),
  -- A published entry without a published_at cannot be ordered by recency, and
  -- an entry with one that is not published would leak into "newest".
  CONSTRAINT archive_published_has_date
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_archive_entries_status ON public.archive_entries(status);
CREATE INDEX IF NOT EXISTS idx_archive_entries_type ON public.archive_entries(media_type);
CREATE INDEX IF NOT EXISTS idx_archive_entries_published ON public.archive_entries(published_at DESC);
-- "Top rated" only ever looks at rows past the gate, so the gate is in the index.
CREATE INDEX IF NOT EXISTS idx_archive_entries_scored
  ON public.archive_entries(has_score, vote_count DESC) WHERE status = 'published';

COMMENT ON COLUMN public.archive_entries.has_score IS
  'vote_count >= 10. An entry below the gate shows "NEW · n votes" and must never appear in Top rated — one person must not be able to render 100%.';

-- ── Votes ───────────────────────────────────────────────────────────────────
-- One row per (entry, member). `value` is the whole score: "Would you
-- recommend this to another wlw?" — yes or no. No stars, no sub-scores.

CREATE TABLE IF NOT EXISTS public.archive_votes (
  entry_id   uuid NOT NULL REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  value      boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, profile_id)
);

-- ── Reviews ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.archive_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       uuid NOT NULL REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  is_recommend   boolean NOT NULL,
  helpful_count  integer NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  status         text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed')),
  -- The one Archive rule. Stored rather than merely shown, so a spoiler report
  -- can be answered with what she agreed to.
  no_spoilers_ack boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- One review per member per entry: the review carries her name, and a
  -- second one is an edit of the first.
  UNIQUE (entry_id, author_id),
  CONSTRAINT archive_review_ack_required CHECK (no_spoilers_ack = true)
);

CREATE INDEX IF NOT EXISTS idx_archive_reviews_entry
  ON public.archive_reviews(entry_id, created_at DESC) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.archive_review_helpful (
  review_id  uuid NOT NULL REFERENCES public.archive_reviews(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, profile_id)
);

-- ── Content notes ───────────────────────────────────────────────────────────
-- Community-tagged and agreement-weighted: a note shows on the card once three
-- members agree. Endings are NEVER tagged — that is policy, and it is why
-- there is no "ending" note kind here to be tempted by.

CREATE TABLE IF NOT EXISTS public.archive_content_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 60),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  agree_count integer NOT NULL DEFAULT 0 CHECK (agree_count >= 0),
  status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, label)
);

CREATE TABLE IF NOT EXISTS public.archive_note_agreements (
  note_id    uuid NOT NULL REFERENCES public.archive_content_notes(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, profile_id)
);

-- ── Watchlist ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.archive_watchlist (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, entry_id)
);

-- ── Revisions ───────────────────────────────────────────────────────────────
-- Member-maintained, mod-published. `patch` is what was proposed and `prev` is
-- what the row held when it was proposed — keeping both is what makes a revert
-- possible and what makes a stale patch detectable at review time.

CREATE TABLE IF NOT EXISTS public.archive_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  patch        jsonb NOT NULL,
  prev         jsonb,
  kind         public.archive_revision_kind NOT NULL,
  status       public.archive_revision_status NOT NULL DEFAULT 'pending',
  reviewed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  -- A decided revision must say who decided it and when; a pending one must
  -- not pretend to have been decided.
  CONSTRAINT archive_revision_decided_consistently
    CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  -- An edit is an edit OF something. A create has no entry until it is
  -- approved, which is exactly why entry_id is nullable.
  CONSTRAINT archive_revision_edit_has_entry
    CHECK (kind = 'create' OR entry_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_archive_revisions_queue
  ON public.archive_revisions(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_archive_revisions_entry
  ON public.archive_revisions(entry_id, created_at DESC);

COMMENT ON TABLE public.archive_revisions IS
  'Every proposed create or edit, with the row state it was proposed against. Mods publish; the credit stays with submitted_by.';
