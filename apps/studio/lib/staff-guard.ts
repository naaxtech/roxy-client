import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side staff gate for Studio pages and server actions.
 *
 * The sidebar hides staff links from members, but a hidden link is not
 * authorization: every /staff page is reachable by URL and every server action
 * is a public POST endpoint that any signed-in member can call with a crafted
 * request. RLS is still the last line; this is the first one, so a member gets a
 * 404 / an error instead of a staff screen rendered against whatever her own
 * row-level grants happen to return.
 */

export interface StaffViewer {
  userId: string;
  isCore: boolean;
}

async function loadStaffViewer(): Promise<StaffViewer | null> {
  const supabase = await createClient();
  // getUser() re-validates the JWT with Supabase Auth; getClaims() alone only
  // checks the signature locally, which is fine for rendering but actions are
  // the write path.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff, staff_role')
    .eq('id', user.id)
    .maybeSingle();

  const row = profile as { is_staff: boolean | null; staff_role?: string | null } | null;
  if (row?.is_staff !== true) return null;
  return { userId: user.id, isCore: row.staff_role === 'core' };
}

/** For staff pages: 404 unless the viewer is Roxy staff. */
export async function requireStaffPage(): Promise<StaffViewer> {
  const viewer = await loadStaffViewer();
  if (!viewer) notFound();
  return viewer;
}

/** For staff server actions: throws unless the caller is Roxy staff. */
export async function assertStaffAction(): Promise<StaffViewer> {
  const viewer = await loadStaffViewer();
  if (!viewer) throw new Error('Staff only.');
  return viewer;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject anything that is not a UUID before it reaches a query. */
export function assertUuid(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}
