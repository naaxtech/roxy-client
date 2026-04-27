import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getLiveGames, getCommunityGameIds } from '@/lib/games';
import { GameSelectorClient } from './GameSelectorClient';

export default async function GamesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Communities where the user is admin or moderator
  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id, communities(id, name)')
    .eq('user_id', user.id)
    .in('role', ['admin', 'moderator']);

  const communities = (memberships ?? [])
    .map((m) => {
      const c = m.communities as unknown as { id: string; name: string } | null;
      return c;
    })
    .filter((c): c is { id: string; name: string } => c != null);

  if (communities.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="text-muted-foreground">
          You need to be an admin or moderator of a community to manage games.{' '}
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
