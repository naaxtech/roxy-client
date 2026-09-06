/**
 * Signup must open the account she just created — not whoever was on this
 * device last. Supabase will keep a leftover session if we do not throw it
 * away, and it will pretend a repeated email "signed up" (empty identities)
 * so we do not leak whether the address exists.
 */

export function sessionEmailMatches(
  session: { user?: { email?: string | null } } | null,
  email: string,
): boolean {
  const actual = session?.user?.email?.trim().toLowerCase() ?? '';
  const wanted = email.trim().toLowerCase();
  return actual !== '' && wanted !== '' && actual === wanted;
}

export function isGhostSignupUser(
  user: { identities?: Array<{ id?: string }> | null } | null,
): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}

/** A cached profile from the previous login must never speak for this session. */
export function storedProfileIsForUser(
  profileId: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(profileId && userId && profileId === userId);
}
