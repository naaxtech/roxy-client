import { supabase } from './supabase';
import { sanitizeForPattern } from './ilikePattern';

export type SearchCommunity = { id: string; name: string; description: string | null };
export type SearchPerson = { id: string; display_name: string | null; username: string | null };
export type SearchEvent = { id: string; title: string; starts_at: string };
export type SearchBusiness = { id: string; name: string; description: string | null };

export type GlobalSearchResult = {
  communities: SearchCommunity[];
  people: SearchPerson[];
  events: SearchEvent[];
  businesses: SearchBusiness[];
};

const EMPTY_RESULT: GlobalSearchResult = { communities: [], people: [], events: [], businesses: [] };
const LIMIT = 5;

/**
 * Resolves a Supabase query to a plain array — never throws, never surfaces
 * an `error` field to the caller. A failed table lookup degrades to an empty
 * section instead of blanking the whole search screen.
 */
async function safeQuery<T>(
  promise: PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  try {
    const { data, error } = await promise;
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

// The escaper moved to lib/ilikePattern.ts when a second call site turned up
// building the same filter strings without it — see that file for what each
// character does if it survives into the query.

/**
 * How many words of a query are honoured. Four is past the point of usefulness
 * and short of letting a pasted paragraph build an eighty-clause query.
 */
export const MAX_SEARCH_TERMS = 4;

/**
 * The words that must ALL match.
 *
 * `ChipSearchBar` in the Build tab let her stack search terms as chips and
 * ANDed them, so "vegan" + "bakery" found the business that was both. The 3.0
 * flattening merged business lookup into `/search`, which treated the whole
 * string as one literal pattern — `%vegan bakery%` matches a business named
 * exactly that and nothing else. Two words made results vanish, and a search
 * that returns nothing reads as an empty directory, not as a mis-asked question.
 *
 * Duplicates are dropped case-insensitively: typing a word twice narrows
 * nothing and costs a clause.
 */
export function searchTerms(q: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of q.trim().split(/\s+/)) {
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(word);
    if (terms.length === MAX_SEARCH_TERMS) break;
  }
  return terms;
}

/**
 * One `.ilike()` per term. PostgREST ANDs repeated filter parameters, so the
 * chain narrows rather than widens — verified against the URL supabase-js
 * 2.105.4 actually builds, which emits a separate parameter per call.
 * // src: https://docs.postgrest.org/en/v12/references/api/tables_views.html · PostgREST 12 · 2026-09-01
 */
function andIlike<T extends { ilike: (column: string, pattern: string) => T }>(
  query: T, column: string, patterns: string[]
): T {
  return patterns.reduce((acc, pattern) => acc.ilike(column, pattern), query);
}

/** One `or=(…)` group per term: any of the columns may match, but every term must. */
function andAnyColumn<T extends { or: (filters: string) => T }>(
  query: T, columns: readonly string[], patterns: string[]
): T {
  return patterns.reduce(
    (acc, pattern) => acc.or(columns.map((column) => `${column}.ilike.${pattern}`).join(',')),
    query
  );
}

/**
 * Global search across communities, people, events, and businesses.
 * Four independent ILIKE queries run in parallel; any single table failing
 * (RLS denial, network blip) degrades to an empty array for that section
 * only — the rest of the results still return.
 */
export async function globalSearch(q: string): Promise<GlobalSearchResult> {
  // Sanitize per term, not per phrase: a comma has to be stripped inside its
  // own clause, or it reads as the separator BETWEEN clauses and corrupts the
  // filter grammar. A term that sanitizes away to nothing is not a term.
  const patterns = searchTerms(q)
    .map((term) => sanitizeForPattern(term))
    .filter((term) => term.length > 0)
    .map((term) => `%${term}%`);

  if (patterns.length === 0) return EMPTY_RESULT;

  const [communities, people, events, businesses] = await Promise.all([
    safeQuery<SearchCommunity>(
      andIlike(supabase.from('communities').select('id,name,description'), 'name', patterns).limit(LIMIT)
    ),
    safeQuery<SearchPerson>(
      andAnyColumn(
        supabase.from('profiles').select('id,display_name,username'),
        ['display_name', 'username'],
        patterns
      ).limit(LIMIT)
    ),
    safeQuery<SearchEvent>(
      andIlike(supabase.from('events').select('id,title,starts_at'), 'title', patterns).limit(LIMIT)
    ),
    safeQuery<SearchBusiness>(
      // Name, description AND category — the three columns `ChipSearchBar`
      // searched. Matching name alone loses "bakery" for a business called
      // Wildflower, which is most of them.
      andAnyColumn(
        supabase.from('businesses').select('id,name,description'),
        ['name', 'description', 'category'],
        patterns
      ).limit(LIMIT)
    ),
  ]);

  return { communities, people, events, businesses };
}
