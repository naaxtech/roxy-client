import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getGame, getSubmissionEvents, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import { BuildSubmitForm } from './BuildSubmitForm';

const ACTION_LABEL: Record<string, string> = {
  submitted: 'Pitch submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  resubmitted: 'Resubmitted',
};

const ACTION_COLOR: Record<string, string> = {
  submitted: 'bg-blue-500',
  approved: 'bg-green-500',
  rejected: 'bg-destructive',
  changes_requested: 'bg-orange-500',
  resubmitted: 'bg-blue-500',
};

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const [game, events] = await Promise.all([getGame(id), getSubmissionEvents(id)]);

  if (!game) notFound();
  // Only submitter or staff can view
  if (game.submitted_by !== user.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_staff')
      .eq('id', user.id)
      .single();
    if (!profile?.is_staff) notFound();
  }

  const canSubmitBuild = game.status === 'pitch_approved' || game.status === 'build_changes';
  const latestFeedback = [...events].reverse().find((e) => e.roxy_feedback)?.roxy_feedback;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Back */}
      <Link
        href="/games/submissions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← My submissions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{game.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{game.short_description}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[game.status]}`}
        >
          {STATUS_LABEL[game.status]}
        </span>
      </div>

      {/* Pitch fields */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Pitch Details
        </h2>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium mb-0.5">How it works</p>
            <p className="text-muted-foreground whitespace-pre-wrap">{game.how_it_works}</p>
          </div>
          <div>
            <p className="font-medium mb-0.5">Why it fits the WLW community</p>
            <p className="text-muted-foreground whitespace-pre-wrap">{game.why_wlw}</p>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Category: <strong className="text-foreground capitalize">{game.category}</strong></span>
            <span>Submitted: <strong className="text-foreground">{formatSubmittedAt(game.created_at)}</strong></span>
          </div>
        </div>
      </div>

      {/* Roxy feedback */}
      {latestFeedback && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Roxy Feedback</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{latestFeedback}</p>
        </div>
      )}

      {/* Build submission form (unlocked when pitch approved or changes requested) */}
      {canSubmitBuild && <BuildSubmitForm gameId={game.id} status={game.status} />}

      {/* Event timeline */}
      <div className="space-y-2">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Timeline
        </h2>
        <div className="relative pl-5 space-y-4">
          {/* vertical line */}
          <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-border" />
          {events.map((event) => (
            <div key={event.id} className="relative flex gap-3">
              <div
                className={`absolute -left-3.5 top-1 w-3 h-3 rounded-full border-2 border-background ${ACTION_COLOR[event.action] ?? 'bg-muted'}`}
              />
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">
                  {ACTION_LABEL[event.action] ?? event.action}
                  <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                    ({event.stage})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSubmittedAt(event.created_at)}
                </p>
                {event.developer_notes && (
                  <p className="text-xs text-muted-foreground italic">{event.developer_notes}</p>
                )}
                {event.roxy_feedback && (
                  <p className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1 mt-1">
                    Roxy: {event.roxy_feedback}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
