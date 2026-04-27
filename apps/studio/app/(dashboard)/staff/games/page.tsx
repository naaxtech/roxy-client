import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getPendingReviews, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';

export default async function StaffGamesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  const pending = await getPendingReviews();
  const pitches = pending.filter((g) => g.status === 'pitch_pending');
  const builds = pending.filter((g) => g.status === 'build_pending');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Game Review Queue</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review community game submissions. Oldest first.
        </p>
      </div>

      {pending.length === 0 && (
        <p className="text-muted-foreground text-sm">No pending submissions. All clear.</p>
      )}

      {/* Pitches */}
      {pitches.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            Pitches
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold">
              {pitches.length}
            </span>
          </h2>
          <div className="rounded-xl border border-border overflow-hidden divide-y">
            {pitches.map((game) => {
              const submitter = game.profiles;
              const handle = submitter?.username ?? submitter?.display_name ?? 'Unknown';
              return (
                <Link
                  key={game.id}
                  href={`/staff/games/${game.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium truncate">{game.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {handle} · {formatSubmittedAt(game.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[game.status]}`}>
                      {STATUS_LABEL[game.status]}
                    </span>
                    <span className="text-muted-foreground text-sm">→</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Builds */}
      {builds.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            Builds
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
              {builds.length}
            </span>
          </h2>
          <div className="rounded-xl border border-border overflow-hidden divide-y">
            {builds.map((game) => {
              const submitter = game.profiles;
              const handle = submitter?.username ?? submitter?.display_name ?? 'Unknown';
              return (
                <Link
                  key={game.id}
                  href={`/staff/games/${game.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium truncate">{game.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {handle} · {formatSubmittedAt(game.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[game.status]}`}>
                      {STATUS_LABEL[game.status]}
                    </span>
                    {game.url && (
                      <a
                        href={game.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Open →
                      </a>
                    )}
                    <span className="text-muted-foreground text-sm">→</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
