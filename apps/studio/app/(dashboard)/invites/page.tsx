import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { InviteCodesClient, type InviteCodeItem, type CommunityOption } from './InviteCodesClient';

export const dynamic = 'force-dynamic';

/** A codes list is a keyring. Nobody needs the whole history on one screen. */
const CODE_LIMIT = 200;

interface CodeRow {
  id: string;
  code: string;
  community_id: string;
  label: string | null;
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  locked_at: string | null;
  created_at: string;
  communities: { name: string } | null;
}

interface MembershipRow {
  community_id: string;
  role: string;
  communities: { name: string } | null;
}

/**
 * Invite codes — the only way anyone gets into Roxy.
 *
 * There is no community filter on the codes query. `ic_read_own_community`
 * (migration 070) already restricts every row to a community the caller
 * administers, and Roxy staff to all of them. A second copy of that rule here
 * would be one more thing that can drift away from the one protecting the data.
 *
 * The membership query is separate and does have a filter, because it answers a
 * different question: not "which codes may I see" but "which communities may I
 * mint a code for" — the list behind the create form.
 */
export default async function InvitesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const [memberships, codes] = await Promise.all([
    supabase
      .from('community_members')
      .select('community_id, role, communities(name)')
      .eq('user_id', userId)
      .in('role', ['admin', 'border_patrol']),
    supabase
      .from('invite_codes')
      .select(
        'id, code, community_id, label, max_uses, uses_count, expires_at, revoked_at, locked_at, created_at, communities(name)',
      )
      .order('created_at', { ascending: false })
      .limit(CODE_LIMIT),
  ]);

  const membershipRows = (memberships.data ?? []) as unknown as MembershipRow[];
  const communities: CommunityOption[] = membershipRows.map((row) => ({
    id: row.community_id,
    name: row.communities?.name ?? 'Unnamed community',
  }));

  const codeRows = (codes.data ?? []) as unknown as CodeRow[];
  const communityNames = new Map(communities.map((c) => [c.id, c.name]));
  const items: InviteCodeItem[] = codeRows.map((row) => ({
    id: row.id,
    code: row.code,
    communityName:
      row.communities?.name ?? communityNames.get(row.community_id) ?? 'Unnamed community',
    label: row.label,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
  }));

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Invite codes</h1>
        <p className="text-muted-foreground mt-1">
          Roxy is invite-only. A code is how one specific woman gets in, and every member stays
          traceable to the code that admitted her — so a code is a credential, not a link.
          Hand it to someone you know, the way you would a house key.
        </p>
      </div>

      {memberships.error ? (
        <ErrorPanel>
          We could not load the communities you administer, so the create form is unavailable.
          Reload the page — if it keeps failing, your session may have expired.
        </ErrorPanel>
      ) : communities.length === 0 ? (
        <div className="border rounded-lg p-8 space-y-3">
          <p className="font-medium">You do not administer a community yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            Invite codes belong to a community — that is what makes an invitation attributable
            and what decides who reviews the application afterwards. Create a community, or ask
            an admin of yours to make you one, and this page opens.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/community">Go to Community</Link>
          </Button>
        </div>
      ) : codes.error ? (
        <ErrorPanel>
          We could not load your existing codes. You can still create a new one below, but the
          list is out of date until this loads — reload before revoking anything.
        </ErrorPanel>
      ) : null}

      {communities.length > 0 && !memberships.error && (
        <InviteCodesClient
          userId={userId}
          communities={communities}
          codes={items}
          codesFailedToLoad={Boolean(codes.error)}
          truncated={items.length >= CODE_LIMIT}
          nowIso={new Date().toISOString()}
        />
      )}
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
