import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getMySubmissions, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import type { GameStatus } from '@/lib/games';

// Progress dots: Pitch → Build → Live
const STAGES: { label: string; statuses: GameStatus[] }[] = [
  { label: 'Pitch', statuses: ['pitch_pending', 'pitch_approved', 'pitch_rejected'] },
  { label: 'Build', statuses: ['build_pending', 'build_changes'] },
  { label: 'Live', statuses: ['live', 'suspended'] },
];

function stageIndex(status: GameStatus): number {
  if (['pitch_pending', 'pitch_approved', 'pitch_rejected'].includes(status)) return 0;
  if (['build_pending', 'build_changes'].includes(status)) return 1;
  if (['live', 'suspended'].includes(status)) return 2;
  return 0;
}

export default async function SubmissionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const submissions = await getMySubmissions(user.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Game Submissions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track the status of your game pitches and builds.
          </p>
        </div>
        <Link
          href="/games/submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          + New Pitch
        </Link>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 p-8 text-center space-y-3">
          <p className="text-muted-foreground">You haven&apos;t submitted any game pitches yet.</p>
          <Link
            href="/games/submit"
            className="inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Submit your first pitch →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((game) => {
            const currentStage = stageIndex(game.status);
            return (
              <Link
                key={game.id}
                href={`/games/submissions/${game.id}`}
                className="block rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <h3 className="font-semibold truncate">{game.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {game.short_description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatSubmittedAt(game.updated_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[game.status]}`}
                  >
                    {STATUS_LABEL[game.status]}
                  </span>
                </div>

                {/* Progress dots */}
                <div className="mt-4 flex items-center gap-2">
                  {STAGES.map((stage, i) => {
                    const filled = i <= currentStage;
                    const rejected =
                      (game.status === 'pitch_rejected' && i === 0) ||
                      (game.status === 'suspended' && i === 2);
                    return (
                      <div key={stage.label} className="flex items-center gap-2">
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              rejected
                                ? 'bg-destructive'
                                : filled
                                ? 'bg-primary'
                                : 'bg-muted-foreground/30'
                            }`}
                          />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {stage.label}
                          </span>
                        </div>
                        {i < STAGES.length - 1 && (
                          <div
                            className={`h-0.5 w-8 mb-3 ${
                              i < currentStage ? 'bg-primary' : 'bg-muted-foreground/30'
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
