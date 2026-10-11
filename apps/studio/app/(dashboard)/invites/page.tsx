import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { InviteCodesClient, type CommunityOption } from './InviteCodesClient';
import { ReviewCodeMint } from './ReviewCodeMint';
import { mapLedgerRow, type LedgerRow } from '@/lib/inviteLedger';
import { isMissingFunction } from '@/lib/schema-availability';

export const dynamic = 'force-dynamic';

/** A codes list is a keyring. Nobody needs the whole history on one screen. */
const CODE_LIMIT = 200;

/**
 * Invite codes — the only way anyone gets into Roxy (Nicole, 2026-10-11).
 *
 * Who may mint: every Roxy staff member, for any community; a community admin
 * or owner, for her own community. Every code is single use, and the database
 * (migration 134) enforces all of it: can_mint_invite_for() on insert, the
 * admin cap of unused codes (staff uncapped), single redemption. Minting never
 * approves anyone: her application still goes to review.
 *
 * Accountability: invite_code_ledger() returns, per code, who minted it, who
 * used it, when, her membership status now and her last sign-in. Staff see
 * every code; an admin sees the codes she minted. `?community=<id>` narrows the
 * list to one community (the Community area links here per community).
 */
export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}) {
  const params = await searchParams;
  const onlyCommunity = params.community?.trim() || null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: me } = await supabase
    .from('profiles')
    .select('is_staff, staff_role')
    .eq('id', userId)
    .maybeSingle();
  const isStaff = Boolean((me as { is_staff?: boolean } | null)?.is_staff);
  const isCore = (me as { staff_role?: string | null } | null)?.staff_role === 'core';

  // Where she may mint. Staff: every community. Otherwise the communities she
  // administers or created; the insert policy has the final word either way.
  const [allCommunities, adminOf, owned, ledger, quota] = await Promise.all([
    isStaff
      ? supabase.from('communities').select('id, name').order('name').limit(500)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    isStaff
      ? Promise.resolve({ data: [] as unknown[], error: null })
      : supabase
          .from('community_members')
          .select('community_id, communities(id, name)')
          .eq('user_id', userId)
          .eq('role', 'admin'),
    isStaff
      ? Promise.resolve({ data: [] as { id: string; name: string }[], error: null })
      : supabase.from('communities').select('id, name').eq('created_by', userId),
    supabase.rpc('invite_code_ledger', { p_community_id: onlyCommunity, p_limit: CODE_LIMIT }),
    supabase.rpc('invite_code_quota_ok'),
  ]);

  const scopeError = allCommunities.error ?? adminOf.error ?? owned.error;
  const byId = new Map<string, CommunityOption>();
  for (const c of (allCommunities.data ?? []) as { id: string; name: string }[]) byId.set(c.id, c);
  for (const row of (adminOf.data ?? []) as { communities: { id: string; name: string | null } | null }[]) {
    if (row.communities) byId.set(row.communities.id, { id: row.communities.id, name: row.communities.name ?? 'Unnamed community' });
  }
  for (const c of (owned.data ?? []) as { id: string; name: string }[]) byId.set(c.id, c);
  let communities = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (onlyCommunity) communities = communities.filter((c) => c.id === onlyCommunity);

  const ledgerMissing = isMissingFunction(ledger.error);
  const codes = ledger.error ? [] : ((ledger.data ?? []) as LedgerRow[]).map(mapLedgerRow);
  const quotaOk = quota.error ? true : quota.data !== false;
  const focused = onlyCommunity ? communities[0]?.name ?? null : null;

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Invite codes{focused ? ` — ${focused}` : ''}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Roxy is invite-only. A code is how one specific woman gets in, once, and every member
          stays traceable to the code and the person that brought her in. Hand it to someone you
          know, the way you would a house key.
        </p>
        {onlyCommunity && (
          <Link href="/invites" className="text-sm underline underline-offset-4 mt-2 inline-block">
            Show codes for every community
          </Link>
        )}
      </div>

      {scopeError ? (
        <ErrorPanel>
          We could not load the communities you administer, so the create form is unavailable.
          Reload the page — if it keeps failing, your session may have expired.
        </ErrorPanel>
      ) : communities.length === 0 && codes.length === 0 ? (
        <div className="border rounded-lg p-8 space-y-3">
          <p className="font-medium">
            {isStaff ? 'There are no communities yet' : 'You do not administer a community yet'}
          </p>
          <p className="text-sm text-muted-foreground max-w-prose">
            Invite codes belong to a community: that is what makes an invitation attributable.
            {isStaff
              ? ' Create one and you can mint a code for it from here.'
              : ' Create a community, or ask an admin of yours to make you one, and this page opens.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/community">Go to Community</Link>
          </Button>
        </div>
      ) : ledgerMissing ? (
        <ErrorPanel>
          The code ledger is not switched on in this database yet (migration 134). Nothing is
          wrong with your codes; the list appears once it is.
        </ErrorPanel>
      ) : ledger.error ? (
        <ErrorPanel>
          We could not load the codes. You can still create a new one below, but the list is out of
          date until this loads — reload before revoking anything.
        </ErrorPanel>
      ) : null}

      {!scopeError && (communities.length > 0 || codes.length > 0) && (
        <InviteCodesClient
          userId={userId}
          isStaff={isStaff}
          quotaOk={quotaOk}
          communities={communities}
          codes={codes}
          codesFailedToLoad={Boolean(ledger.error)}
          truncated={codes.length >= CODE_LIMIT}
          nowIso={new Date().toISOString()}
          readOnly={communities.length === 0}
        />
      )}

      {isCore && !onlyCommunity && <ReviewCodeMint />}
    </div>
  );
}

function ErrorPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
    >
      <p className="text-sm text-destructive">{children}</p>
    </div>
  );
}
