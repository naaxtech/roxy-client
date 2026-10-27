# Archive search, slice 1: the search engine. Plan

Spec: `docs/superpowers/specs/2026-10-26-archive-search-design.md`, decision 3, slice 1.
Branch `slice/roxy/archive-search` (worktree `w3-b`). Line it moves: **retained revenue**. The Archive
is the members' home screen, and today its search is a title ILIKE that misses a typo or an accent.

This slice ships the engine and points the existing screen at it. It does not include the taxonomy
tables (slice 2), the new browse UI (slice 3) or Studio (slice 4).

## What changes

### Database: migration 138 `archive_search`

| Object | What it is |
|---|---|
| `pg_trgm`, `unaccent` | Installed in `extensions`, the same convention 011/049/051 follow for `pgcrypto`. |
| `public.archive_unaccent(text)` | An IMMUTABLE wrapper with a pinned dictionary and `search_path = ''`, so the function can be used in an index expression. |
| `public.archive_search_document(title, creator, summary, taxonomy)` | Builds the weighted vector: title A, creator B, **taxonomy C**, summary D, all unaccented. `taxonomy` is the hook slice 2 fills with genre and tag names. Today the trigger passes nothing, and the check proves the C weight works. |
| `public.archive_entries_search_tsv()` | Same trigger and same `updated_at` behaviour. It now calls `archive_search_document`. |
| backfill | `UPDATE … SET search_tsv = archive_search_document(…)`. It touches only `search_tsv`, so the `UPDATE OF title, creator, summary` trigger does not fire and `updated_at` does not move. |
| indexes | `idx_archive_entries_search` (GIN tsv) is kept. New: `idx_archive_entries_title_trgm` and `idx_archive_entries_creator_trgm`, both GIN `gin_trgm_ops` on `archive_unaccent(lower(col))`. |
| `public.archive_search_input(q, types, year_from, year_to, min_stars)` | Validates the shared filters and parses `q` exactly once. It returns the websearch tsquery, the exclusion tsquery (`-word` / `-"phrase"`), the positive text used for fuzzy matching, and a LIKE pattern. Both RPCs call it, so they cannot disagree on what a query means. |
| `public.archive_search(...)` | The RPC: rows shaped like `archive_ranked_view` plus `match_rank`. |
| `public.archive_search_facets(...)` | One row per `archive_media_type`, giving the count for the current query and filters. The type counts ignore `p_types`, because a dimension's own filter never narrows its own counts (picking Film must not make TV read 0). |

How a match works, for a non-empty `q`:
- **Exact path:** `search_tsv @@ websearch_to_tsquery('simple', unaccent(q))`. Quotes, `or` and `-word` behave as in websearch.
- **Fuzzy path:** the positive text is a substring of the unaccented title or creator (this keeps today's ILIKE behaviour, so nothing that matches now stops matching), or `positive <% title/creator` at `word_similarity` 0.5.
- The fuzzy path also honours the exclusions: a fuzzy hit is dropped when its tsv matches the exclusion query.
- `match_rank` = `ts_rank_cd` + the best `word_similarity` on title or creator.
- Sort `relevance` orders by `match_rank`, then falls back to the `top` order.
- The four existing sorts copy `lib/archive.ts` `fetchArchiveEntries` exactly. Each ends on `id`.

An empty `q` is browse: every published entry, in the chosen sort.

Security and bounds:
- `SECURITY INVOKER`. The function reads `archive_ranked_view` (security_invoker, `status = 'published'`) joined to `archive_entries`, so RLS decides visibility and browse stays published-only, for staff too, exactly as the view does.
- `SET search_path`. The trigram threshold is pinned on the function with `SET pg_trgm.word_similarity_threshold`.
- Out-of-bounds input raises 22023:
  - `q` over 100 characters after trim
  - more than 20 types
  - a year outside 1800–2200, or `from > to`
  - `min_stars` outside 0–5
  - a sort outside top / voted / newest / needs / relevance
  - `limit` outside 1–50
  - `offset` outside 0–10000
- `REVOKE ALL … FROM PUBLIC, anon`, then `GRANT EXECUTE … TO authenticated`. The two pure helpers are also granted to `service_role`, because edge-function writes evaluate the index expression and the trigger.

Down (`supabase/downs/138_archive_search_down.sql`):
- Drop the RPCs, the input helper and the trigram indexes.
- Restore the 097 trigger body byte for byte.
- Recompute `search_tsv` with 097's expression.
- Drop the document builder and the wrapper.
- The extensions stay installed. `IF NOT EXISTS` cannot tell whether 138 installed them or found them, and dropping one that something else uses does more harm than leaving an unused one in place.

### Client: `apps/mobile`

- `lib/archive.ts`
  - `fetchArchiveEntries` keeps its signature. It now calls `supabase.rpc('archive_search', …)`: `query → p_q`, `mediaType → p_types[1]`, `sort`, `limit`, `offset`.
  - When the RPC is missing (PostgREST `PGRST202`, or HTTP 404), it runs today's ILIKE query on `archive_ranked_view`. That code moves, unchanged, into the private `fetchArchiveEntriesByTitle`. Any other error is logged and thrown, as today.
  - No module state: the first request after the owner applies 138 uses the engine.
- `fetchArchiveTypeCounts` keeps its signature. It now calls `archive_search_facets` (one request). On a missing RPC it runs today's five head counts.
- `store/archiveStore.ts`: the fetch path stays `fetchArchiveEntries`. The store tests prove that `load` and `loadMore` reach the RPC with her filters and that the fallback keeps the screen alive.

## Tests first (each watched failing before the code)

1. `supabase/tests/138_archive_search_check.sql`. Each DO block RAISEs on a failure. Impersonation uses `SET LOCAL ROLE` plus `request.jwt.claims`, as in 136. The checks:
   - T1 catalogue: extensions, INVOKER, search_path, indexes, grants.
   - T2 weighted, unaccented tsv; C weight via the hook; backfill complete.
   - T3 typo: `portrat` and `portrat of a lady` find *Portrait of a Lady on Fire*.
   - T4 accents: `celine sciamma`, `Céline`, `monae` and `Monáe` all match.
   - T5 `-word` exclusion, on both the exact and the fuzzy path.
   - T6 type filter.
   - T7 year range.
   - T8 sorts equal the client's view order; paging is a slice of the full order.
   - T9 facets: 5 rows, sum = search total across query shapes, a per-type count = a type-filtered search, `p_types` ignored.
   - T10 pending and hidden entries are invisible to a pending member and absent from the facets.
   - T11 new and renamed rows are re-indexed by the trigger.
   - T12 `min_stars` and `scored_only`.
   - T13 relevance puts the closest match first; browse rank is 0.
   - T14 anon refused.
   - T15 every input bound rejected with 22023, and a 100-character `q` padded with spaces accepted.
2. `apps/mobile/__tests__/lib/archiveSearch.test.ts`:
   - RPC path: parameter mapping, rows returned, errors thrown.
   - Fallback path: PGRST202 and a bare 404 run the ILIKE query.
   - Facets path and fallback head counts.
3. `apps/mobile/__tests__/store/archiveStoreSearch.test.ts`: the store with the real `lib/archive`, on a mocked supabase: `load` and `loadMore` with the RPC present and with it missing.
4. Existing `archiveSort` and `archiveTopSort` tests: their supabase mock gains an `rpc` that answers PGRST202, so they keep proving the fallback's ordering.

## Proof

- GREEN: `migration-proof.cjs <w3-b> 138_archive_search`.
- RED: the same with `--mutate`, dropping the fuzzy-path exclusion. T5 must fail.
- Down cycle: `D:\Work\_scratch\roxy-archive\down-cycle.cjs` runs one BEGIN…ROLLBACK:
  1. Snapshot the pre-138 catalogue: public functions with bodies, the indexes on `archive_entries`, the trigger, and a digest of `search_tsv`.
  2. Run the migration, then the check, then the down.
  3. Assert the snapshot is identical.
  4. Run the migration and the check again.
- `node scripts/check-migrations.mjs`; from `apps/mobile`, `npx jest --ci` (full), `npx tsc --noEmit`, `npx eslint <changed> --max-warnings 0`.

## Order

1. Plan (this file).
2. Check file and jest tests; run them RED.
3. Migration and down; run GREEN, RED and the down cycle.
4. `lib/archive.ts`; jest GREEN.
5. check-migrations, full jest, tsc, eslint.

## Review fixes (2026-10-27)

These supersede the matching lines above.

- **Watchlist reads by id.** `SavedWatchlist` asked browse for 200 rows, and `archive_search` refuses more
  than 50 (22023). It now calls `fetchArchiveEntriesByIds`: `archive_ranked_view` with `.in('id', …)` in
  chunks of 100, most voted first. `fetchArchiveEntries` also caps a page at `ARCHIVE_SEARCH_MAX_LIMIT`
  (50). No other caller asks for more than 50.
- **Relevance first.** With a query, rows order by `match_rank` under every sort, and the sort only breaks
  ties. `match_rank` = `ts_rank_cd(…, 32)` [0,1) + best `word_similarity` [0,1] + 2 for an exact folded
  title (1 for a title prefix), so an exact title always leads. `relevance` is now `top` by another name.
- **SECURITY DEFINER.** Under RLS, members got full scans (~120 ms at 10k rows). Both RPCs are now DEFINER
  and read one INVOKER row set, `archive_search_rows`, that members cannot call. Its
  `status = 'published'` is the whole visibility rule, which is exactly 096's policy and 123's view as a
  member sees them. Browse and search are UNION ALL arms gated by `q_browse`, so a generic plan keeps the
  BitmapOr over the tsv and trigram indexes. Measured at 10k rows, as `authenticated`: about 7 ms, down from
  about 125 ms.
- **Wordless queries.** `"`, `-` or `?!` find nothing; they are not a browse. `or` alone is fuzzy text.
- **Fallback.** The fallback runs on PGRST202 only. A 42883 or a bare 404 is a real error. The first
  fallback of a session per RPC leaves one breadcrumb (`archive_search_fallback`, `{ rpc }`), with no
  query text.
- New checks:
  - T1 asserts DEFINER, and that a member cannot execute the row set.
  - T10 adds a rejected fixture, staff, and facets.
  - T16: browse equals the view row for row, as a member and as staff.
  - T17: relevance first under every sort.
  - T18: wordless queries, and `or`.
- RED: drop the published filter, and T6, T10 and T16 each fail.

## Owner-gated

- Applying 138 to production, which enables `pg_trgm` and `unaccent` there.
- Before applying, run `select extname, extnamespace::regnamespace from pg_extension where extname in ('pg_trgm','unaccent')`. If either is already installed outside `extensions`, the qualified names in 138 fail loudly at apply time rather than half-work.
- Until 138 is applied, the client falls back to the ILIKE query, so the screen never breaks.
