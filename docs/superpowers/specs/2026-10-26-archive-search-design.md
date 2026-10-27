# The Archive — a real collection and a real search — design

Owner, 2026-10-26: "The Archive should be a robust collection and search of WLW media, make search filter
robust, and the UI modern."
Line it moves: **retained revenue**. The Archive is the public members' home screen (`feed/index.tsx:290`),
so it is the first thing a new member uses. Today it is 45 entries and a title search.
Branch `slice/roxy/archive-search` (worktree `roxy-client-worktrees/w3-b`).

## What exists (map, 2026-10-26)

- `archive_entries` (095):
  - `media_type` enum `film | tv | book | comic | music`, plus `release_year`, `creator`, `summary`, cover;
  - votes and stars, reviews, content notes (free-text, shown at 3 agreements), watchlist, shelf;
  - member-suggested revisions approved by staff (Studio), and staff direct edits.
- **No genre, tags or representation fields.**
- Search: `lib/archive.ts:255` uses `title.ilike OR creator.ilike` on `archive_ranked_view`.
  - `search_tsv` (`simple` config, GIN index, 097:146) exists and **nothing queries it**.
  - No `pg_trgm` or `unaccent`.
  - The only filters are type chips and 4 sorts.
  - Global search uses the same ILIKE.
- UI: one FlatList of rows (2:3 cover + text), a search pill, type chips and sort chips. The loading,
  error and empty states are good, and so is pull-to-refresh. Design truth (`design-direction.md:384`):
  editorial voice, uploaded 2:3 covers, designed type covers, no emoji in chips, rows separated by space.
- 45 seeded works, in prod too. Studio has entry CRUD and a revision queue, but no bulk import.

## Decisions (reversible; stated, not asked)

**1. A taxonomy the members can filter on: three controlled vocabularies, staff-managed.**
- **Genres** (romance, drama, comedy, thriller, fantasy, sci-fi, horror, documentary, coming-of-age,
  historical, poetry, memoir, …). Many per entry.
- **Representation tags**, the reason the Archive exists:
  - lesbian lead, bi lead, sapphic ensemble, trans woman lead, nonbinary character, WLW of colour,
    older WLW, disabled WLW;
  - coming out, established couple, found family, slow burn;
  - **happy ending**, **no queer death** (the "bury your gays" check members ask for first).
- **Content notes** stay as they are, member-agreed, and become an exclude filter: "Hide entries noted
  for: sexual violence, suicide, homophobia, …".
- Tables `archive_genres`, `archive_tags` (with a `kind`: representation | theme) and the join tables
  `archive_entry_genres`, `archive_entry_tags`. RLS: read for `authenticated`, write staff-only through
  SECURITY DEFINER RPCs (`is_staff`). Members propose tags through the existing revision flow
  (`archive-submit-edit` carries tag ids); staff approve in the existing Studio queue.

**2. More kinds of media.** Extend the enum with `podcast`, `game`, `web_series` and `short_film`. A
lot of WLW work lives exactly there. Each gets a type cover and a chip.

**3. A search that finds things.** A new RPC, `archive_search(p_q, p_types, p_genres, p_tags,
p_exclude_notes, p_year_from, p_year_to, p_min_stars, p_scored_only, p_sort, p_limit, p_offset)`:
- Weighted `search_tsv`: title A, creator B, tags and genres C, summary D. It is rebuilt by trigger,
  including when a tag changes. `unaccent` keeps "Amélie" and "Amelie" the same.
- `websearch_to_tsquery` for normal queries (quotes and `-word` work), plus `pg_trgm` similarity on
  title/creator for typos and partial words ("portrat of a lady" finds *Portrait of a Lady on Fire*).
  Rank = ts_rank + trigram score, then the chosen sort.
- **Facet counts** come back in the same call: how many results per type, genre and tag for the current
  query and filters, so the filter sheet shows "Happy ending · 12" and never offers a dead end.
- SECURITY DEFINER, with visibility (published only, exactly what RLS and `archive_ranked_view` show a
  member) written into the one row set both RPCs read. Under a member's RLS the indexes could not be used.
  Inputs are bounded (q ≤ 100 chars, arrays ≤ 20, limit ≤ 50).
- Global search (`lib/globalSearch.ts`) switches to the same RPC.

**4. A modern browse screen**, inside v2's design direction, not a new style:
- A sticky search field at the top. Under it, a row of the **active filters** as removable chips, then
  "Filters" (opens a `Sheet` with facet counts) and a sort menu.
- **Cover grid**: 2 columns on a phone, 3 on an unfolded Fold or tablet, 4 on wide web. Each tile is the
  2:3 cover, the title (2 lines max) and "Film · 2019 · 4.4 from 7 members" in words, as v2 asks. A list
  toggle keeps today's rows for members who prefer them.
- Discovery shelves when there is no query: "New in the Archive", "Happy endings", "Top rated films",
  "Books members are reading" (watchlist). One horizontal rail each, then the full grid.
- Recent searches stay on the device. "No results" offers to clear the last filter, then "Suggest it as
  a new entry".
- Skeleton tiles, error with Retry, pull-to-refresh, strings in localisable form, light theme tokens,
  48 dp targets, every chip with an accessible name and its count read out.
- Design pass with `impeccable` + `ui-ux-pro-max` + the taste skill, judged against
  `polish/design-direction.md` with screenshots at 360, 390 and 412 wide.

**5. Growing the collection** ("robust collection"):
- Studio gets **CSV bulk import**: title, type, year, creator, summary, genres, tags, cover URL. A preview
  with per-row validation comes first, and everything lands as published or pending as staff choose.
- The new tags are seeded on the 45 existing entries by a reviewed data script, not by a guess.
- **Deferred, with a trigger:** auto-fill from TMDB (film/TV) and Open Library (books) when staff add an
  entry. Trigger: the owner provides a TMDB API key. Open Library needs none, so it can come first if
  wanted.

## Emotional-AI value

Which representation members search for and filter out is a strong, consented signal of what they need
from stories. Log the filter usage as counts by tag id. Never log the query text, which is free text.

## Slices (each ships on its own)

1. **Search engine:** migration 138 (`pg_trgm`, `unaccent`, weighted tsv, `archive_search` with facets),
   with its check file and down. Wire the current screen's search to it. Invisible to members except
   that search gets better.
2. **Taxonomy:** migration (genres, tags, joins, staff RPCs, enum values) and the Studio tag editor in
   the entry form. Seed the vocabularies.
3. **Browse UI:** grid, filter sheet with facets, active chips, shelves, and global search on the RPC.
4. **Collection growth:** Studio CSV import, plus the tag backfill for the 45 entries.

## Owner-gated

Applying each migration to prod (enabling `pg_trgm`/`unaccent` on prod), the tag backfill data write,
deploys, and the TMDB key (optional).
