/**
 * staff_launch_funnel() (migration 131) → a typed funnel for the staff
 * overview. Postgres bigints arrive as numbers or numeric strings depending on
 * size, so every count is coerced here; a shape that is not a funnel is null.
 */

export interface FunnelWave {
  label: string;
  codes: number;
  redemptions: number;
  applications: number;
  approved: number;
}

export interface LaunchFunnel {
  accounts: number;
  profiles: number;
  applicationsStarted: number;
  applicationsSubmitted: number;
  applicationsPending: number;
  approved: number;
  rejected: number;
  membersApproved: number;
  suspended: number;
  reportsPending: number;
  waves: FunnelWave[];
}

function n(value: unknown): number {
  const v = typeof value === 'string' ? Number(value) : value;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseFunnel(raw: unknown): LaunchFunnel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.waves !== undefined && !Array.isArray(r.waves)) return null;
  const waves = ((r.waves as unknown[] | undefined) ?? [])
    .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === 'object')
    .map((w) => ({
      label: typeof w.label === 'string' ? w.label : '(no label)',
      codes: n(w.codes),
      redemptions: n(w.redemptions),
      applications: n(w.applications),
      approved: n(w.approved),
    }));
  return {
    accounts: n(r.accounts),
    profiles: n(r.profiles),
    applicationsStarted: n(r.applications_started),
    applicationsSubmitted: n(r.applications_submitted),
    applicationsPending: n(r.applications_pending),
    approved: n(r.approved),
    rejected: n(r.rejected),
    membersApproved: n(r.members_approved),
    suspended: n(r.suspended),
    reportsPending: n(r.reports_pending),
    waves,
  };
}

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}
