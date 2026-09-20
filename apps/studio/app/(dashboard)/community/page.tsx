import { createClient } from '@/lib/supabase/server';
import { getHostScope } from '@/lib/hostScope';
import { Badge } from '@/components/ui/badge';
import { CreateCommunityForm } from './CreateCommunityForm';

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const scope = await getHostScope(supabase, userId, ['admin']);
  const communities = scope.communities;

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
            : 'You are not an admin of any community yet.'}
        </p>
      ) : (
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
            </li>
          ))}
        </ul>
      )}

      <CreateCommunityForm />
    </div>
  );
}
