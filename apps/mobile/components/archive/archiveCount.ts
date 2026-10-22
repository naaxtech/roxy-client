import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';

/**
 * How many entries the Archive holds — a count, not a download.
 *
 * Discover used to fetch 200 full rows of `archive_ranked_view` (`select *`)
 * only to print `rows.length` in the rail's "See all N" label, on the same
 * slow connection as every other rail's first request (jank audit #4). A
 * `head` request returns the count in the response header and no rows. Same
 * view, so the number agrees with what the Archive list pages through.
 *
 * Throws on failure (after logging), like `fetchArchiveEntries`, so the rail
 * shows its error state instead of a wrong number.
 */
export async function fetchArchiveTotal(): Promise<number> {
  const { count, error } = await supabase
    .from('archive_ranked_view')
    .select('id', { count: 'exact', head: true });
  if (error) {
    logError(error, 'archive.fetchArchiveTotal');
    throw error;
  }
  return count ?? 0;
}
