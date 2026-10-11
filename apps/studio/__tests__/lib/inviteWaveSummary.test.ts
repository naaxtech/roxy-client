import { summariseWaves } from '@/lib/inviteWaves';
import { mapLedgerRow, type LedgerRow } from '@/lib/inviteLedger';

/**
 * /staff/launch/waves reads public.invite_code_ledger() (migration 134), not
 * invite_codes directly: the ledger is the one place that knows a code was
 * used (redeemed_by / redeemed_at, kept even after her account is erased) and
 * who minted it. A wave = her own invite codes sharing a label.
 */
const NOW = Date.parse('2026-10-11T12:00:00Z');
const ME = 'staff-1';

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    code_id: Math.random().toString(36).slice(2),
    code: 'ABCD2345',
    community_id: 'k1',
    community_name: 'Roxy Official',
    label: 'Wave 1',
    kind: 'invite',
    created_at: '2026-10-01T10:00:00Z',
    expires_at: '2026-10-20T23:59:59Z',
    revoked_at: null,
    locked_at: null,
    minted_by: ME,
    minter_name: 'Nic',
    minter_username: 'nic',
    redeemed_by: null,
    redeemer_name: null,
    redeemer_username: null,
    redeemed_at: null,
    redeemer_status: null,
    redeemer_last_sign_in: null,
    ...over,
  };
}

const waves = (rows: LedgerRow[]) => summariseWaves(rows.map(mapLedgerRow), ME, NOW);

describe('summariseWaves', () => {
  it('counts codes, redeemed and still-usable per label, newest wave first', () => {
    const out = waves([
      row({ label: 'Wave 1' }),
      row({ label: 'Wave 1', redeemed_by: 'u9', redeemed_at: '2026-10-02T10:00:00Z', redeemer_status: 'pending' }),
      row({ label: 'Wave 1', revoked_at: '2026-10-03T10:00:00Z' }),
      row({ label: 'Wave 2', created_at: '2026-10-05T10:00:00Z', expires_at: '2026-10-30T23:59:59Z' }),
    ]);
    expect(out).toEqual([
      { label: 'Wave 2', codes: 1, redeemed: 0, live: 1, firstCreated: '2026-10-05T10:00:00Z', expires: '2026-10-30T23:59:59Z' },
      { label: 'Wave 1', codes: 3, redeemed: 1, live: 1, firstCreated: '2026-10-01T10:00:00Z', expires: '2026-10-20T23:59:59Z' },
    ]);
  });

  it('a code whose redeemer was erased still counts as redeemed, never as usable', () => {
    const [w] = waves([row({ redeemed_by: null, redeemed_at: '2026-10-02T10:00:00Z', redeemer_status: 'account_deleted' })]);
    expect(w).toMatchObject({ redeemed: 1, live: 0 });
  });

  it('expired and locked codes are not usable', () => {
    const [w] = waves([
      row({ expires_at: '2026-10-10T23:59:59Z' }),
      row({ locked_at: '2026-10-04T10:00:00Z' }),
    ]);
    expect(w).toMatchObject({ codes: 2, live: 0 });
  });

  it('only her own labelled invite codes: no other minter, no review/member codes, no unlabelled codes', () => {
    expect(waves([
      row({ minted_by: 'someone-else' }),
      row({ kind: 'review' }),
      row({ kind: 'member' }),
      row({ label: null }),
      row({ label: '   ' }),
    ])).toEqual([]);
  });
});
