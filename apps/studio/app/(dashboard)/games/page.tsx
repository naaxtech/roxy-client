import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getHostScope } from '@/lib/hostScope';
import { getLiveGames, getCommunityGameIds } from '@/lib/games';
import { GameSelectorClient } from './GameSelectorClient';

export default async function GamesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const scope = await getHostScope(supabase, user.id, ['admin', 'moderator']);
  const communities = scope.communities.map((c) => ({ id: c.id, name: c.name }));

  if (communities.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="text-muted-foreground">
          {scope.isCore
            ? 'There are no communities yet, so there is nowhere to enable a game.'
            : 'You need to be an admin or moderator of a community to manage games.'}{' '}
          <a href="/community" className="text-primary underline-offset-4 hover:underline">
            Go to Community.
          </a>
        </p>
      </div>
    );
  }

  const defaultCommunity = communities[0];
  const [allGames, enabledIds] = await Promise.all([
    getLiveGames(),
    getCommunityGameIds(defaultCommunity.id),
  ]);

  return (
    <div className="max-w-5xl">
      <GameSelectorClient
        allGames={allGames}
        initialEnabledIds={[...enabledIds]}
        communities={communities}
        defaultCommunityId={defaultCommunity.id}
      />
    </div>
  );
}
