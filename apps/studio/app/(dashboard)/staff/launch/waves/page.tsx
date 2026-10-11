import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/staff-guard';
import { formatUtcDate } from '@/lib/dates';
import { mapLedgerRow, type LedgerRow } from '@/lib/inviteLedger';
import { summariseWaves } from '@/lib/inviteWaves';
import { InviteWaveClient, type WaveCommunity } from './InviteWaveClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Launch waves — Roxy Studio' };

/** Enough for every wave a staffer mints at launch (200 codes per wave). */
const LEDGER_LIMIT = 1000;

interface WaveRow {
  label: string | null;
  uses_count: number;
  max_uses: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface WaveSummary {
  label: string;
  codes: number;
  redeemed: number;
  live: number;
  firstCreated: string;
  expires: string | null;
}

/**
 * UNUSED since integration (launch/integration, after migration 134). Origin:
 * ops2 d3e6941 (ST-05), which read invite_codes directly and counted
 * uses_count. 134 made every code single use and moved "who used it" to
 * redeemed_by/redeemed_at, read through invite_code_ledger(); the page now
 * uses lib/inviteWaves summariseWaves() over the ledger. Kept (not deleted)
 * per the repo rule; may be used again if the page ever needs to run against
 * a database without 134. Delete only with Nicole's agreement.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function summarise(rows: WaveRow[], now: number): WaveSummary[] {
  const map = new Map<string, WaveSummary>();
  for (const r of rows) {
    const label = r.label?.trim() || '(no label)';
    const s = map.get(label) ?? { label, codes: 0, redeemed: 0, live: 0, firstCreated: r.created_at, expires: r.expires_at };
    s.codes += 1;
    s.redeemed += r.uses_count > 0 ? 1 : 0;
    const expired = r.expires_at ? new Date(r.expires_at).getTime() <= now : false;
    const usedUp = r.max_uses != null && r.uses_count >= r.max_uses;
    if (!r.revoked_at && !expired && !usedUp) s.live += 1;
    if (r.created_at < s.firstCreated) s.firstCreated = r.created_at;
    if (r.expires_at && (!s.expires || r.expires_at > s.expires)) s.expires = r.expires_at;
    map.set(label, s);
  }
  return [...map.values()].sort((a, b) => b.firstCreated.localeCompare(a.firstCreated));
}

export default async function LaunchWavesPage() {
  const viewer = await requireStaffPage();
  const supabase = await createClient();

  // Waves read invite_code_ledger() (134), the one source that knows a code
  // was used even after the woman's account is erased, and who minted it.
  const [communities, codes] = await Promise.all([
    supabase.from('communities').select('id, name').order('name').limit(200),
    supabase.rpc('invite_code_ledger', { p_community_id: null, p_limit: LEDGER_LIMIT }),
  ]);

  const waves = codes.error
    ? []
    : summariseWaves(((codes.data ?? []) as LedgerRow[]).map(mapLedgerRow), viewer.userId, Date.now());

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <Link href="/staff/launch" className="text-sm text-muted-foreground hover:underline">
          ← Launch access
        </Link>
        <h1 className="text-2xl font-bold mt-2">Launch waves</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Mint a batch of single-use invite codes for one wave of the launch. Every code admits one
          woman into the application queue — a person still decides. The wave label is how the
          launch funnel on the staff overview counts redemptions, applications and approvals.
        </p>
      </div>

      {communities.error ? (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
          <p className="text-sm text-destructive">
            We could not load communities, so the form is off. Reload the page; if it keeps failing, your
            session may have expired.
          </p>
        </div>
      ) : (
        <InviteWaveClient communities={(communities.data ?? []) as WaveCommunity[]} />
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your waves</h2>
        {codes.error ? (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
            <p className="text-sm text-destructive">
              We could not load your earlier waves. This is a loading failure, not an empty history.
            </p>
          </div>
        ) : waves.length === 0 ? (
          <p className="text-sm text-muted-foreground">No waves yet. Your first batch will show here.</p>
        ) : (
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-medium">Wave</th>
                <th className="p-2 font-medium">Codes</th>
                <th className="p-2 font-medium">Redeemed</th>
                <th className="p-2 font-medium">Still usable</th>
                <th className="p-2 font-medium">Created</th>
                <th className="p-2 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {waves.map((w) => (
                <tr key={w.label}>
                  <td className="p-2">{w.label}</td>
                  <td className="p-2">{w.codes}</td>
                  <td className="p-2">{w.redeemed}</td>
                  <td className="p-2">{w.live}</td>
                  <td className="p-2">{formatUtcDate(w.firstCreated)}</td>
                  <td className="p-2">{w.expires ? formatUtcDate(w.expires) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground max-w-prose">
          Codes themselves are listed on <Link href="/invites" className="underline">Invite codes</Link>, where
          you can revoke them. A code string is a key — it is shown in full only once, right after you create it.
        </p>
      </section>
    </div>
  );
}
