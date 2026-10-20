import { createClient } from '@/lib/supabase/server';
import { isMissingFunction } from '@/lib/schema-availability';
import { parseFunnel } from '@/lib/launchFunnel';
import { LaunchFunnelView } from './LaunchFunnelView';

/**
 * Launch funnel card for the staff overview: accounts → started → applied →
 * approved, per-wave redemption, pending reports and suspensions, from
 * staff_launch_funnel() (migration 131, staff-only, re-checked in SQL).
 *
 * Self-contained on purpose: staff/page.tsx gets one import and one JSX line,
 * so lanes adding cards there merge cleanly. A failed query renders an error,
 * never zeros — zeros on a launch dashboard read as "nobody came".
 */
export async function LaunchFunnelCard() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_launch_funnel');
  const funnel = error ? null : parseFunnel(data);

  return (
    <section className="space-y-3" aria-labelledby="launch-funnel-heading">
      <h2 id="launch-funnel-heading" className="text-lg font-semibold">
        Launch funnel
      </h2>
      {error && isMissingFunction(error) ? (
        <p className="text-sm text-muted-foreground">
          The launch funnel needs migration 131 on this database. It has not been applied yet.
        </p>
      ) : !funnel ? (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
          <p className="text-sm text-destructive">
            We could not load the launch funnel. These are unknown numbers, not zeros — reload to try again.
          </p>
        </div>
      ) : (
        <LaunchFunnelView funnel={funnel} />
      )}
    </section>
  );
}
