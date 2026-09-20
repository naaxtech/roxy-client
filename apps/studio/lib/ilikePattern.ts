/** Same rules as the mobile escaper: drop PostgREST delimiters, escape wildcards. */
export function sanitizeForPattern(input: string): string {
  return input.replace(/[,()]/g, '').replace(/[%_]/g, '\\$&');
}

export function ilikePattern(term: string): string | null {
  const safe = sanitizeForPattern(term.trim());
  if (safe.length === 0) return null;
  return `%${safe}%`;
}
