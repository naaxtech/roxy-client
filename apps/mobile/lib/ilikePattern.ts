/**
 * Making user input safe to put inside an ILIKE pattern or a PostgREST `.or()`
 * filter string.
 *
 * Two different problems, both invisible when they happen:
 *
 *  - `,` `(` `)` are the PostgREST filter grammar's own delimiters. Interpolated
 *    raw, a query like `"bakery,cafe"` or `"f(x)"` is read as extra clauses and
 *    the request comes back empty — which looks exactly like "there is nothing
 *    here" rather than "that request was malformed".
 *  - `%` and `_` are the ILIKE wildcards. Unescaped, a chip of `_` matches every
 *    row in the table, and the woman searching gets the whole directory back
 *    with no indication why.
 *
 * This lived as a private function inside `lib/globalSearch.ts` while
 * `buildStore.loadBusinesses` — the other place a search term reaches a filter
 * string — built its clauses by bare interpolation. One escaper, imported by
 * both, is the only arrangement where the two cannot disagree.
 */
export function sanitizeForPattern(input: string): string {
  const withoutFilterDelimiters = input.replace(/[,()]/g, '');
  return withoutFilterDelimiters.replace(/[%_]/g, '\\$&');
}

/**
 * A term ready to drop into `column.ilike.<pattern>`, or `null` if sanitizing
 * left nothing behind. A pattern of `%%` matches every row, so a term made
 * entirely of delimiters has to be dropped rather than passed through.
 */
export function ilikePattern(term: string): string | null {
  const safe = sanitizeForPattern(term.trim());
  if (safe.length === 0) return null;
  return `%${safe}%`;
}
