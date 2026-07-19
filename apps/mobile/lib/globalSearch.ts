import { supabase } from './supabase';

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

/**
 * Global search across communities, people, events, and businesses.
 * Four independent ILIKE queries run in parallel; any single table failing
 * (RLS denial, network blip) degrades to an empty array for that section
 * only — the rest of the results still return.
 */
export async function globalSearch(q: string): Promise<GlobalSearchResult> {
  const query = q.trim();
  if (!query) return EMPTY_RESULT;

  const pattern = `%${query}%`;

  const [communities, people, events, businesses] = await Promise.all([
    safeQuery<SearchCommunity>(
      supabase.from('communities').select('id,name,description').ilike('name', pattern).limit(LIMIT)
    ),
    safeQuery<SearchPerson>(
      supabase
        .from('profiles')
        .select('id,display_name,username')
        .or(`display_name.ilike.${pattern},username.ilike.${pattern}`)
        .limit(LIMIT)
    ),
    safeQuery<SearchEvent>(
      supabase.from('events').select('id,title,starts_at').ilike('title', pattern).limit(LIMIT)
    ),
    safeQuery<SearchBusiness>(
      supabase.from('businesses').select('id,name,description').ilike('name', pattern).limit(LIMIT)
    ),
  ]);

  return { communities, people, events, businesses };
}
