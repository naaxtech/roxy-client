import { createClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/staff-guard';
import { MemberTagClient, type TaggableMember } from './MemberTagClient';

export const dynamic = 'force-dynamic';

/**
 * Staff assign the tags that appear under a name on Discover's Top 10.
 *
 * Editorial, not earned. A badge is what the product awards for doing
 * something; this is what the team says about someone — "Archivist",
 * "Community builder" — and its entire value is that it did not come from her.
 * Migration 121 is what makes that true rather than a convention: the column is
 * withheld from the member grant, and `profiles_guard_staff_tag` refuses a
 * change from anyone `is_roxy_staff()` does not recognise.
 *
 * The list is the leaderboard itself, in its own order, so a tag can be judged
 * against the nine it will sit beside rather than in isolation.
 *
 * The database (migration 121) remains the authority on who may WRITE a tag.
 * The page itself is still staff-gated server-side, like every other /staff
 * route: the leaderboard query below runs on the viewer's session, and a member
 * who types the URL should get a 404, not a staff tool rendered against her
 * own grants.
 */
export default async function MemberTagsPage() {
  await requireStaffPage();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, username, gamification_points, staff_tag, staff_tag_set_at')
    .eq('is_ghost', false)
    .in('vetting_status', ['approved', 'unvetted'])
    .order('gamification_points', { ascending: false })
    .order('display_name', { ascending: true })
    .limit(10);

  const members: TaggableMember[] = (data ?? []).map((row) => ({
    id: row.id as string,
    displayName: (row.display_name as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    points: (row.gamification_points as number | null) ?? 0,
    tag: (row.staff_tag as string | null) ?? null,
    setAt: (row.staff_tag_set_at as string | null) ?? null,
  }));

  return (
    <div className="space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Member tags</h1>
        <p className="text-sm text-muted-foreground">
          The line under a name on Discover’s Top 10. Two words is plenty —
          “Archivist”, “Community builder”. Leave it empty to clear one.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          The leaderboard could not be loaded.
        </p>
      ) : (
        <MemberTagClient members={members} />
      )}
    </div>
  );
}
