import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertUuid, requireStaffPage } from '@/lib/staff-guard';
import { isMissingFunction } from '@/lib/schema-availability';
import { formatUtcDate, formatUtcDateTime } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { contentTypeLabel, reasonLabel } from '@/lib/reports';
import { displayNameOf, vettingLabel, type MemberSearchRow } from '@/lib/members';
import { MemberSuspensionPanel } from '../MemberSuspensionPanel';

export const dynamic = 'force-dynamic';

interface SuspensionRow {
  id: string;
  reason: string;
  suspended_at: string;
  lifted_at: string | null;
  lift_note: string | null;
}

interface ReportRow {
  id: string;
  content_type: string;
  reason: string;
  status: string;
  created_at: string;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
      <p className="text-sm text-destructive">{children}</p>
    </div>
  );
}

export default async function StaffMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage();
  let id: string;
  try {
    id = assertUuid((await params).id, 'member id');
  } catch {
    notFound();
  }

  const supabase = await createClient();
  const [member, suspensions, reports] = await Promise.all([
    supabase.rpc('staff_search_members', { p_query: id, p_limit: 1 }),
    supabase
      .from('account_suspensions')
      .select('id, reason, suspended_at, lifted_at, lift_note')
      .eq('user_id', id)
      .order('suspended_at', { ascending: false })
      .limit(20),
    supabase
      .from('reports')
      .select('id, content_type, reason, status, created_at')
      .eq('reported_user_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const back = (
    <Link href="/staff/members" className="text-sm text-muted-foreground hover:underline">
      ← Members
    </Link>
  );

  if (member.error) {
    return (
      <div className="max-w-4xl space-y-4">
        {back}
        <ErrorBox>
          {isMissingFunction(member.error)
            ? 'Member tools need migration 131 on this database. It has not been applied yet.'
            : 'We could not load this member. Reload the page; if it keeps failing, your session may have expired.'}
        </ErrorBox>
      </div>
    );
  }

  const row = ((member.data ?? []) as MemberSearchRow[]).find((m) => m.id === id);
  if (!row) notFound();

  const name = displayNameOf(row);
  const history = (suspensions.data ?? []) as SuspensionRow[];
  const reportRows = (reports.data ?? []) as ReportRow[];

  return (
    <div className="max-w-4xl space-y-6">
      {back}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-3 flex-wrap">
          {name}
          {row.suspended && <Badge variant="destructive">Suspended</Badge>}
          {row.is_deleted && <Badge variant="outline">Deleted</Badge>}
          {row.is_staff && <Badge variant="secondary">{row.staff_role === 'core' ? 'Core' : 'Staff'}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          {row.username ? `@${row.username} · ` : ''}
          {vettingLabel(row.vetting_status)} · joined {formatUtcDate(row.created_at)}
        </p>
      </div>

      {row.suspended && (
        <div className="border border-destructive/40 rounded-lg p-4 text-sm space-y-1">
          <p className="font-medium">
            Suspended {row.suspended_at ? formatUtcDateTime(row.suspended_at) : ''}
          </p>
          {row.suspension_reason && <p className="text-muted-foreground whitespace-pre-wrap">{row.suspension_reason}</p>}
        </div>
      )}

      <MemberSuspensionPanel
        userId={row.id}
        name={name}
        suspended={row.suspended}
        viewerIsCore={viewer.isCore}
        isSelf={viewer.userId === row.id}
      />

      <section className="space-y-2">
        <h2 className="font-semibold">
          Reports about her{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {Number(row.reports_pending)} pending · {Number(row.reports_total)} total
          </span>
        </h2>
        {reports.error ? (
          <ErrorBox>We could not load her reports. This is a loading failure, not a clean record.</ErrorBox>
        ) : reportRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has reported her.</p>
        ) : (
          <ul className="divide-y border rounded-lg overflow-hidden text-sm">
            {reportRows.map((r) => (
              <li key={r.id} className="p-3 flex items-center gap-3">
                <Badge variant="outline">{contentTypeLabel(r.content_type)}</Badge>
                <span>{reasonLabel(r.reason)}</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatUtcDate(r.created_at)}</span>
                <Badge variant={r.status === 'pending' ? 'destructive' : 'outline'}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        {Number(row.reports_pending) > 0 && (
          <Link href="/staff/reports" className="text-sm underline">
            Resolve pending reports in the queue
          </Link>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Suspension history</h2>
        {suspensions.error ? (
          <ErrorBox>We could not load her suspension history.</ErrorBox>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never suspended.</p>
        ) : (
          <ul className="divide-y border rounded-lg overflow-hidden text-sm">
            {history.map((s) => (
              <li key={s.id} className="p-3 space-y-0.5">
                <p>
                  {formatUtcDateTime(s.suspended_at)}
                  {s.lifted_at ? ` → lifted ${formatUtcDateTime(s.lifted_at)}` : ' → active'}
                </p>
                <p className="text-muted-foreground whitespace-pre-wrap">{s.reason}</p>
                {s.lift_note && <p className="text-xs text-muted-foreground">Lifted: {s.lift_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
