import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHostScope } from '@/lib/hostScope';
import { Badge } from '@/components/ui/badge';
import { QueryError } from '@/components/QueryError';
import {
  isLocationSchemaMissing,
  toCommunityLocation,
  type CommunityLocation,
  type CommunityLocationRow,
} from '@/lib/communityLocation';
import { CommunityLocationEditor } from './CommunityLocationEditor';
import { CreateCommunityForm } from './CreateCommunityForm';

const NO_LOCATION: CommunityLocation = { city: null, meets: 'online' };

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  // Moderators may set where a community meets (set_community_location), so
  // they see the communities they moderate here too; invite codes stay admin-only.
  const scope = await getHostScope(supabase, userId, ['admin', 'moderator']);
  const communities = scope.communities;

  // Where each one meets (migration 139). Studio ships ahead of the database:
  // columns that are not there yet mean no editor, not an error.
  const locations = new Map<string, CommunityLocation>();
  let locationsState: 'ready' | 'unavailable' | 'failed' = 'ready';
  if (communities.length > 0) {
    const base = supabase
      .from('communities')
      .select('id, meets, city_id, cities(id, name, admin1, country_code)');
    const { data, error } = scope.isCore
      ? await base
      : await base.in('id', communities.map((c) => c.id));
    if (isLocationSchemaMissing(error)) {
      locationsState = 'unavailable';
    } else if (error) {
      locationsState = 'failed';
    } else {
      for (const row of (data ?? []) as unknown as CommunityLocationRow[]) {
        locations.set(row.id, toCommunityLocation(row));
      }
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="text-muted-foreground mt-1">
          {scope.isCore ? 'Every community on Roxy.' : 'Communities you manage.'}
        </p>
      </div>

      {communities.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {scope.isCore
            ? 'No communities yet. Create the first one below.'
            : 'You are not an admin or moderator of any community yet.'}
        </p>
      ) : (
        <>
          {locationsState === 'failed' && <QueryError what="where your communities meet" />}
          <ul className="space-y-4">
            {communities.map((c) => (
              <li key={c.id} className="border rounded-lg p-6 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{c.name}</h2>
                  <Badge variant="outline">{c.memberCount ?? 0} members</Badge>
                </div>
                {c.description && (
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                )}
                {/* Her codes for this community: who used each, when, and where she stands now. */}
                {c.callerRole === 'admin' && (
                  <Link
                    href={`/invites?community=${encodeURIComponent(c.id)}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Invite codes and who used them
                  </Link>
                )}
                {locationsState === 'ready' && (
                  <CommunityLocationEditor
                    communityId={c.id}
                    communityName={c.name}
                    initial={locations.get(c.id) ?? NO_LOCATION}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <CreateCommunityForm />
    </div>
  );
}
