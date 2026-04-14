import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { BlockPayoutButton } from './BlockPayoutButton';
import { ReleasePayoutButton } from './ReleasePayoutButton';

export default async function StaffPage() {
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

  // Events with blocked payouts or pending payouts
  const { data: blockedEvents } = await supabase
    .from('events')
    .select('id, title, starts_at, status, payout_blocked, payout_released_at, host_id, communities(name)')
    .eq('is_paid', true)
    .eq('payout_blocked', true)
    .is('payout_released_at', null)
    .order('starts_at', { ascending: false })
    .limit(20);

  const { data: pendingPayouts } = await supabase
    .from('events')
    .select('id, title, starts_at, payout_delay_days, ends_at, communities(name)')
    .eq('status', 'completed')
    .eq('is_paid', true)
    .eq('payout_blocked', false)
    .is('payout_released_at', null)
    .order('ends_at', { ascending: true })
    .limit(20);

  // Pending refunds
  const { data: pendingRefunds } = await supabase
    .from('payment_logs')
    .select('id, event_id, amount_cents, needs_refund, refund_error, events(title)')
    .eq('needs_refund', true)
    .is('stripe_refund_id', null)
    .limit(20);

  // Recent audit log
  const { data: auditLog } = await supabase
    .from('audit_log')
    .select('id, event_id, action, notes, created_at, events(title)')
    .order('created_at', { ascending: false })
    .limit(15);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Staff Dashboard</h1>
        <p className="text-muted-foreground mt-1">Payment operations and audit trail.</p>
      </div>

      {/* Blocked Payouts */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Blocked Payouts
          {(blockedEvents ?? []).length > 0 && (
            <Badge variant="destructive">{blockedEvents!.length}</Badge>
          )}
        </h2>
        {(blockedEvents ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {blockedEvents!.map(ev => (
              <li key={ev.id} className="border border-destructive/30 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Link href={`/events/${ev.id}`} className="font-medium hover:underline">
                      {ev.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {(ev.communities as any)?.name} ·{' '}
                      {new Date(ev.starts_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <ReleasePayoutButton eventId={ev.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pending Payouts */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pending Payouts</h2>
        {(pendingPayouts ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {pendingPayouts!.map(ev => {
              const readyAt = ev.ends_at
                ? new Date(new Date(ev.ends_at).getTime() + (ev.payout_delay_days ?? 7) * 86400000)
                : null;
              const isReady = readyAt ? readyAt <= new Date() : false;
              return (
                <li key={ev.id} className="border rounded-lg p-4 flex items-center justify-between gap-3">
                  <div>
                    <Link href={`/events/${ev.id}`} className="font-medium hover:underline">
                      {ev.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {(ev.communities as any)?.name}
                      {readyAt && (
                        <> · {isReady ? 'Ready now' : `Ready ${readyAt.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isReady
                      ? <ReleasePayoutButton eventId={ev.id} />
                      : <Badge variant="secondary">Waiting</Badge>}
                    <BlockPayoutButton eventId={ev.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pending Refunds */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Pending Refunds
          {(pendingRefunds ?? []).length > 0 && (
            <Badge variant="destructive">{pendingRefunds!.length}</Badge>
          )}
        </h2>
        {(pendingRefunds ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {pendingRefunds!.map(r => (
              <li key={r.id} className="border rounded-lg p-3 text-sm">
                <p className="font-medium">{(r.events as any)?.title ?? r.event_id}</p>
                <p className="text-muted-foreground">
                  ${((r.amount_cents ?? 0) / 100).toFixed(2)}
                  {r.refund_error && <span className="text-destructive ml-2">Error: {r.refund_error}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Audit Log */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        {(auditLog ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries.</p>
        ) : (
          <ul className="divide-y border rounded-lg overflow-hidden">
            {auditLog!.map(entry => (
              <li key={entry.id} className="p-3 text-sm flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono font-medium">{entry.action}</span>
                  {entry.notes && <span className="text-muted-foreground ml-2">— {entry.notes}</span>}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(entry.events as any)?.title ?? entry.event_id}
                  </p>
                </div>
                <time className="text-xs text-muted-foreground shrink-0">
                  {new Date(entry.created_at).toLocaleDateString('en-US', {
                    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
