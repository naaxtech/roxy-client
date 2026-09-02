# The WLW Archive — what shipped, and what it is standing on

Session: 2026-09-01/02 · Branch: `feature/wlw-archive` · Design: `docs/handoff/roxy-3.0/`

**Live.** Migrations 092–100 applied to `ptymtdlysqbpxzlgsshp`, four edge functions
deployed, web at <https://roxy.expo.app>. Head is `100`.

---

## The two decisions that shaped everything

### 1. There is no `membership_status`. The Archive reads `vetting_status`.

The brief asked for a new `profiles.membership_status` enum
(`pending | approved | rejected`) with a backfill. That column already existed
under another name and was already load-bearing:

| What the brief asked for | What the repo already had |
|---|---|
| `membership_status` enum | `profiles.vetting_status` — `unvetted \| pending \| approved \| rejected` (070) |
| a backfill so nobody is locked out | done by 072, to `'unvetted'` |
| `staff-approve-member` function | `decide_application` (071), already reviewer-separated |

Adding a second column would have been two stores of one truth. This codebase has
shipped that exact bug: `block_user` wrote `friendships.status='blocked'` that
nothing read, so the app told women they were protected when they were not.

Write access therefore goes through `is_approved_member()` (072), which is
`vetting_status IN ('approved','unvetted')`. **`unvetted` is included
deliberately** — it is the grandfathered pre-gate population, and narrowing the
predicate to `'approved'` alone locks out every account that existed before the
invite gate. 072's own comment says so.

### 2. The Archive is the answer to 079.

`079_restore_vetting_default` is a postmortem: a new signup landed on
`vetting_status='pending'`, every RLS helper returned false, and she was locked
out of the entire app with no screen explaining why.

So the Archive's read policies are deliberately `TO authenticated` and
deliberately do **not** call `is_approved_member()` or
`can_read_community_content()`. Using the ordinary gate helpers here would
silently re-lock the exact door this feature exists to open.

**A pending member may:** browse, search, filter, read every review, cast a
score, keep a watchlist.
**She may not:** write a review, add an entry, suggest an edit, agree a note.
Every locked action opens an explanation. Never a greyed-out dead control.

---

## Schema

| Migration | What it does |
|---|---|
| `095_archive_core` | 8 tables, 4 enums, the `has_score` generated column, **and `ENABLE ROW LEVEL SECURITY` on every table in the same file** |
| `096_archive_rls` | 24 policies |
| `097_archive_triggers` | counters (recomputed, never incremented) + `search_tsv` |
| `098_archive_seed` | 45 real works, 95 content notes, 21 reviews |
| `099_archive_report_reasons` | the three archive report reasons |
| `100_archive_moderation_contract` | archive report content types, staff SELECT/UPDATE on reports, staff UPDATE on entries/reviews, `'reverted'` |

### Three things in here that are load-bearing

**The vote gate is in the schema.** `has_score` is a stored generated column
(`vote_count >= 10`) with a partial index on it. The rule has to hold in the
`ORDER BY` as well as in the label, or "Top rated" leads with one person's
opinion at 100%. `apps/mobile/__tests__/lib/archiveScore.test.ts` reads the
threshold out of the migration and fails if the client's `SCORE_GATE` drifts.

**Seeding without a fuse.** The counters are *recomputed* from `archive_votes`,
not incremented — an increment is one missed edge (a flipped vote, a removed
review, a cascade delete) away from being permanently wrong. That makes naive
seeding a trap: the first woman to vote on a 1,489-vote entry would collapse it
to 1, live. The fabricated weight lives in `baseline_vote_count` /
`baseline_up_count` and the trigger **adds** the real tally to it.

**RLS ships with the table.** 095 enables RLS as it creates each table rather
than leaving it to 096. With RLS on and no policy yet, Postgres denies
everything — so a half-applied migration pair is a broken feature rather than an
open database.

---

## Edge functions

All four deployed.

- `archive-submit-entry` / `archive-submit-edit` — approved members only, checked
  by reading `vetting_status` directly. **`is_approved_member()` cannot be called
  here**: it reads `auth.uid()`, which is null under the service-role client, so
  it would silently answer false for everyone.
- `staff-review-archive-revision` — approve / reject / revert. Idempotent via a
  `.eq('status', …)` row guard rather than read-then-write. A mod may not decide
  her own submission.
- `submit-report` — now validates both `contentType` and `reason` against
  allowlists, so a bad value is a 400 that says what is allowed instead of an
  opaque 23514.

**The patch is untrusted input, even in a staff-only function.** 096's
`archive_revisions_insert_approved` lets any approved member insert a revision
row *directly through RLS*, bypassing the submit functions — so a member can
author the exact JSON a mod will later apply. `staff-review-archive-revision`
whitelists keys and re-validates every value, and rejects the whole patch rather
than silently dropping a bad key. That is the line between a moderation queue and
a privilege-escalation path.

---

## Applying migrations when `db push` will not run

`npx supabase` resolves to a broken local shim that shells out to a `deno` that
is not installed — it fails even on `--version`, which is the tell. The CLI
itself is fine: **`npx --yes supabase@2.99.0`** works.

Two scripts exist for when it does not:

```sh
node scripts/db-query.mjs "select count(*) from public.archive_entries"
node scripts/apply-migration.mjs 095_archive_core.sql
```

`apply-migration.mjs` also writes `supabase_migrations.schema_migrations`.
Applying SQL by hand *without* that row is how a history mismatch starts — the
CLI keeps believing the migration never ran.

---

## How 093 was verified

`093` adds a `BEFORE INSERT` trigger to `conversations`. If it is wrong, every
new DM in production fails, which on this app is the core surface.

It was not verified by reading it. A real `direct` conversation was inserted
under a set `request.jwt.claims`, inside a transaction, and rolled back:

```sql
perform set_config('request.jwt.claims', json_build_object('sub', a::text)::text, true);
insert into public.conversations (participant_ids, conversation_type)
values (array[a, b], 'direct');
```

It passed. All 21 profiles carry `dm_permission = 'everyone'`, so nobody was
silently restricted.

---

## The demo script

1. **Discover → Archive chip.** The rail, then `Browse all 45 →`.
2. **Browse.** Search "carol". Filter to Book. Sort by Most voted.
3. **An entry.** Portrait of a Lady on Fire — 95%, "Community favourite", content
   notes, member reviews.
4. **The gate.** Chappell Roan and Ethel Cain are seeded *below* ten votes on
   purpose: they show `NEW · 7 votes` with no percentage and no ring. That is the
   integrity rule, visible without having to explain it.
5. **Vote.** The score moves. It is added to the baseline, not replacing it.
6. **Pending.** Toggle a profile to `vetting_status='pending'` and reload: the
   banner appears, voting still works, writing a review opens the explanation.
7. **Studio.** `/staff/archive` — member queue, revision queue with the
   side-by-side diff, reports, dashboard.

---

## Known, and deliberate

- **The seeded vote counts are demo weight, not real members.** 098 gates them on
  the dev-seed profiles existing — and this project has those profiles, so they
  applied. A production database without them would read `NEW · 0 votes` on every
  entry, which is the honest state. This is the strongest argument for the
  separate staging database in `_kernel/doctrine/release-pipeline.md`.
- **"Notify mods" is not implemented.** `notifications.type` and
  `email_queue.email_type` are closed CHECKs with no archive member, so an insert
  would violate a constraint. Staff find pending work by querying the queue.
  A real push needs its own migration.
- **Ticket tiers are out of scope.** One `events.price_cents`, no tiers table.
- **There is no mute.** Block, report and local hide are the whole safety surface,
  and the UI says "Blocked" rather than implying otherwise.
