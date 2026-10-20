import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { TONE_CLASSES, formatWait, toneForHours } from '@/lib/applicationQueue';

/** review_queue_stats() (migration 130, section 13). Counts only. */
export interface QueueStats {
  waiting: number;
  overdue: number;
  drafts: number;
  oldest_hours: number;
  open_appeals: number;
  grandfathered_unreviewed: number;
}

/**
 * The staff dashboard's first card (G-10): how many applications are waiting
 * and how long the oldest has waited against the 48-hour promise. Prod's only
 * applicant once waited 33 days because nobody saw the queue; this puts it on
 * the page staff open first.
 */
export function PendingApplicationsCardView({ stats }: { stats: QueueStats | null }) {
  if (!stats) {
    return (
      <section className="border rounded-lg p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load the application queue numbers. Open{' '}
          <Link href="/applications" className="underline">Applications</Link> to check it directly.
        </p>
      </section>
    );
  }

  const tone = toneForHours(stats.oldest_hours);
  return (
    <section className="border rounded-lg p-4 space-y-3" aria-labelledby="pending-applications-title">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="pending-applications-title" className="text-sm font-medium text-muted-foreground">
            Applications waiting for review
          </h2>
          <p data-testid="pending-applications-count" className="text-3xl font-bold leading-none">
            {stats.waiting}
          </p>
        </div>
        {stats.waiting > 0 && (
          <Badge
            data-testid="pending-applications-oldest"
            data-tone={tone}
            variant="outline"
            className={TONE_CLASSES[tone]}
          >
            Oldest waiting {formatWait(stats.oldest_hours)}
          </Badge>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {stats.waiting === 0
          ? 'The queue is clear.'
          : `${stats.overdue} overdue (past the 48 hours we promise applicants).`}
        {stats.drafts > 0 ? ` ${stats.drafts} still drafting, not sent yet.` : ''}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/applications" className="font-medium underline-offset-4 hover:underline">
          Review applications
        </Link>
        {stats.open_appeals > 0 && (
          <Link href="/staff/appeals" className="underline-offset-4 hover:underline">
            {stats.open_appeals} open {stats.open_appeals === 1 ? 'appeal' : 'appeals'}
          </Link>
        )}
        {stats.grandfathered_unreviewed > 0 && (
          <Link href="/staff/appeals" className="text-muted-foreground underline-offset-4 hover:underline">
            {stats.grandfathered_unreviewed} grandfathered, review optional
          </Link>
        )}
      </div>
    </section>
  );
}

/** Server half: one RPC, null for non-staff (the function says so itself). */
export async function PendingApplicationsCard() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('review_queue_stats');
  const stats = error || !data ? null : (data as QueueStats);
  return <PendingApplicationsCardView stats={stats} />;
}
