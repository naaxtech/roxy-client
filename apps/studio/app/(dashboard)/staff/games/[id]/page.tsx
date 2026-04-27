import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getGame, getSubmissionEvents, STATUS_LABEL, STATUS_COLOR, formatSubmittedAt } from '@/lib/games';
import { StaffReviewForm } from './StaffReviewForm';

const ACTION_LABEL: Record<string, string> = {
  submitted: 'Submitted',
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

export default async function StaffGameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const [game, events] = await Promise.all([getGame(id), getSubmissionEvents(id)]);
  if (!game) notFound();

  // Get submitter profile
  let submitter: { username: string | null; display_name: string | null } | null = null;
  if (game.submitted_by) {
    const { data } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', game.submitted_by)
      .single();
    submitter = data;
  }

  const handle = submitter?.username ?? submitter?.display_name ?? 'Unknown';

  // Stage for the current review action
  const reviewStage = game.status === 'pitch_pending' ? 'pitch' : 'build';
  const canReview = game.status === 'pitch_pending' || game.status === 'build_pending';

  return (
    <div className="max-w-4xl space-y-6">
      {/* Back */}
      <Link
        href="/staff/games"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Review queue
      </Link>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Left: submission timeline + details */}
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{game.name}</h1>
              <p className="text-sm text-muted-foreground">
                by {handle} · {formatSubmittedAt(game.created_at)}
              </p>
            </div>
            <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[game.status]}`}>
              {STATUS_LABEL[game.status]}
            </span>
          </div>

          {/* Pitch details */}
          <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Pitch Details
            </h2>
            <div>
              <p className="font-medium mb-0.5">Short description</p>
              <p className="text-muted-foreground">{game.short_description}</p>
            </div>
            <div>
              <p className="font-medium mb-0.5">How it works</p>
              <p className="text-muted-foreground whitespace-pre-wrap">{game.how_it_works}</p>
            </div>
            <div>
              <p className="font-medium mb-0.5">Why it fits WLW</p>
              <p className="text-muted-foreground whitespace-pre-wrap">{game.why_wlw}</p>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground pt-1">
              <span>Category: <strong className="text-foreground capitalize">{game.category}</strong></span>
              <span>Publisher: <strong className="text-foreground capitalize">{game.publisher_type}</strong></span>
            </div>
            {game.url && (
              <div>
                <p className="font-medium mb-0.5">Build URL</p>
                <a
                  href={game.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline break-all"
                >
                  {game.url}
                </a>
              </div>
            )}
          </div>

          {/* Event timeline */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Timeline
            </h2>
            <div className="relative pl-5 space-y-4">
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
                    <p className="text-xs text-muted-foreground">{formatSubmittedAt(event.created_at)}</p>
                    {event.developer_notes && (
                      <p className="text-xs text-muted-foreground italic">{event.developer_notes}</p>
                    )}
                    {event.roxy_feedback && (
                      <p className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1 mt-1">
                        Roxy feedback: {event.roxy_feedback}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: review panel */}
        <div className="lg:sticky lg:top-6">
          {canReview ? (
            <StaffReviewForm gameId={game.id} stage={reviewStage} />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              <p>No review action needed.</p>
              <p className="mt-1">Current status: <strong>{STATUS_LABEL[game.status]}</strong></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
