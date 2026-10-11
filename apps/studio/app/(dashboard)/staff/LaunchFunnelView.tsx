import Link from 'next/link';
import { pct, type LaunchFunnel } from '@/lib/launchFunnel';

/** Presentational half of the launch funnel card (server-renderable, testable). */
export function LaunchFunnelView({ funnel }: { funnel: LaunchFunnel }) {
  const steps = [
    { label: 'Accounts', value: funnel.accounts, note: null },
    { label: 'Started an application', value: funnel.applicationsStarted, note: `${pct(funnel.applicationsStarted, funnel.accounts)} of accounts` },
    { label: 'Applied', value: funnel.applicationsSubmitted, note: `${pct(funnel.applicationsSubmitted, funnel.applicationsStarted)} of started` },
    { label: 'Approved', value: funnel.approved, note: `${pct(funnel.approved, funnel.applicationsSubmitted)} of applied` },
  ];

  return (
    <div className="space-y-4">
      <ol aria-label="Launch funnel" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {steps.map((s) => (
          <li key={s.label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
            {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Link href="/applications" className="hover:underline">
          {funnel.applicationsPending} applications waiting
        </Link>
        <span className="text-muted-foreground">{funnel.rejected} not admitted</span>
        <span className="text-muted-foreground">{funnel.membersApproved} approved members</span>
        <Link href="/staff/reports" className={funnel.reportsPending > 0 ? 'text-destructive hover:underline' : 'hover:underline'}>
          {funnel.reportsPending} pending reports
        </Link>
        <Link href="/staff/members" className="text-muted-foreground hover:underline">
          {funnel.suspended} suspended
        </Link>
      </div>

      {funnel.waves.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No invite waves yet. <Link href="/staff/launch/waves" className="underline">Create the first one</Link>.
        </p>
      ) : (
        <table aria-label="Invite waves" className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-medium">Wave</th>
              <th className="p-2 font-medium">Redeemed / codes</th>
              <th className="p-2 font-medium">Applied</th>
              <th className="p-2 font-medium">Approved</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {funnel.waves.map((w) => (
              <tr key={w.label}>
                <td className="p-2">{w.label}</td>
                <td className="p-2 tabular-nums">{`${w.redemptions} / ${w.codes}`}</td>
                <td className="p-2 tabular-nums">{w.applications}</td>
                <td className="p-2 tabular-nums">
                  {w.approved} <span className="text-xs text-muted-foreground">({pct(w.approved, w.applications)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
