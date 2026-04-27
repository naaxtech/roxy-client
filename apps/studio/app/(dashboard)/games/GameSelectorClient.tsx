'use client';

import { useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import type { Game } from '@/lib/games';

type FilterType = 'all' | 'roxy' | 'community';

interface Props {
  allGames: Game[];
  initialEnabledIds: string[];
  communities: { id: string; name: string }[];
  defaultCommunityId: string;
}

export function GameSelectorClient({
  allGames,
  initialEnabledIds,
  communities,
  defaultCommunityId,
}: Props) {
  const supabase = createClient();

  const [communityId, setCommunityId] = useState(defaultCommunityId);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set(initialEnabledIds));
  const [filter, setFilter] = useState<FilterType>('all');
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // When community changes, reload enabled IDs
  async function handleCommunityChange(id: string) {
    setCommunityId(id);
    const { data } = await supabase
      .from('community_games')
      .select('game_id')
      .eq('community_id', id);
    setEnabledIds(new Set((data ?? []).map((r) => r.game_id)));
  }

  async function toggleGame(game: Game) {
    if (toggling) return;
    setToggling(game.id);
    setError(null);
    const isEnabled = enabledIds.has(game.id);

    if (isEnabled) {
      const { error: err } = await supabase
        .from('community_games')
        .delete()
        .eq('community_id', communityId)
        .eq('game_id', game.id);
      if (err) { setError(err.message); }
      else {
        setEnabledIds((prev) => { const next = new Set(prev); next.delete(game.id); return next; });
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: err } = await supabase
        .from('community_games')
        .insert({ community_id: communityId, game_id: game.id, enabled_by: user?.id });
      if (err) { setError(err.message); }
      else {
        setEnabledIds((prev) => new Set([...prev, game.id]));
      }
    }
    setToggling(null);
  }

  const filtered = allGames.filter((g) => {
    if (filter === 'roxy') return g.publisher_type === 'roxy';
    if (filter === 'community') return g.publisher_type === 'community';
    return true;
  });

  const currentCommunity = communities.find((c) => c.id === communityId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="text-sm text-muted-foreground">
          Choose which games your community can play. Toggle a game to enable or disable it.
        </p>
      </div>

      {/* Community selector + filter */}
      <div className="flex flex-wrap items-center gap-3">
        {communities.length > 1 && (
          <select
            value={communityId}
            onChange={(e) => handleCommunityChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {communities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        <div className="flex rounded-md border border-input overflow-hidden text-sm">
          {(['all', 'roxy', 'community'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <span className="ml-auto text-sm text-muted-foreground">
          {enabledIds.size} enabled for <strong>{currentCommunity?.name}</strong>
        </span>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}

      {/* Games grid */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">No games found.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((game) => {
            const enabled = enabledIds.has(game.id);
            const loading = toggling === game.id;
            return (
              <div
                key={game.id}
                className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-all ${
                  enabled ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
                }`}
              >
                {/* Publisher badge */}
                <span
                  className={`absolute right-3 top-3 text-xs font-medium px-2 py-0.5 rounded-full ${
                    game.publisher_type === 'roxy'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {game.publisher_type === 'roxy' ? '🟣 Roxy' : '👤 Community'}
                </span>

                {/* Thumbnail */}
                {game.thumbnail_url ? (
                  <Image
                    src={game.thumbnail_url}
                    alt={game.name}
                    width={400}
                    height={128}
                    className="w-full h-32 object-cover rounded-lg"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-32 rounded-lg bg-muted flex items-center justify-center text-3xl">
                    🎮
                  </div>
                )}

                <div className="flex-1 space-y-1">
                  <h3 className="font-semibold leading-snug">{game.name}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {game.short_description}
                  </p>
                  <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                    {game.category}
                  </span>
                </div>

                <button
                  onClick={() => toggleGame(game)}
                  disabled={loading}
                  className={`w-full rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    enabled
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-input bg-background hover:bg-muted'
                  }`}
                >
                  {loading ? '…' : enabled ? 'Enabled ✓' : 'Enable'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Submit own game CTA */}
      <div className="rounded-xl border border-dashed border-muted-foreground/30 p-6 text-center space-y-2">
        <p className="text-sm font-medium">Want to add your own game?</p>
        <p className="text-xs text-muted-foreground">
          Community developers can pitch a game idea for Roxy review before building.
        </p>
        <a
          href="/games/submit"
          className="inline-block mt-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          Submit a pitch →
        </a>
      </div>
    </div>
  );
}
