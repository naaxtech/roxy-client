import {
  codeState,
  mapLedgerRow,
  memberStatusLabel,
  openCodeCount,
  type LedgerRow,
} from '@/lib/inviteLedger';

/**
 * Invite-code accountability (Nicole, 2026-10-11): every code is single use and
 * names two people — who minted it and who used it — plus when she used it,
 * where her membership stands now and when she last signed in. The rows come
 * from public.invite_code_ledger() (migration 134), which already decides who
 * may see which code; this module only turns them into what Studio shows.
 */
const NOW = Date.parse('2026-10-11T12:00:00Z');

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    code_id: 'c1',
    code: 'ABCD2345',
    community_id: 'k1',
    community_name: 'Book Club',
    label: 'Maya',
    kind: 'invite',
    created_at: '2026-10-01T10:00:00Z',
    expires_at: '2026-10-20T23:59:59Z',
    revoked_at: null,
    locked_at: null,
    minted_by: 'admin-1',
    minter_name: 'Ana',
    minter_username: 'ana',
    redeemed_by: null,
    redeemer_name: null,
    redeemer_username: null,
    redeemed_at: null,
    redeemer_status: null,
    redeemer_last_sign_in: null,
    ...over,
  };
}

describe('mapLedgerRow', () => {
  it('names the minter and, once used, the woman who used it', () => {
    const used = mapLedgerRow(
      row({
        redeemed_by: 'u-9',
        redeemer_name: 'Maya',
        redeemer_username: 'maya',
        redeemed_at: '2026-10-03T08:00:00Z',
        redeemer_status: 'pending',
        redeemer_last_sign_in: '2026-10-10T00:00:00Z',
      }),
    );
    expect(used.minter).toEqual({ id: 'admin-1', displayName: 'Ana', username: 'ana' });
    expect(used.redeemer).toEqual({
      id: 'u-9',
      displayName: 'Maya',
      username: 'maya',
      redeemedAt: '2026-10-03T08:00:00Z',
      status: 'pending',
      lastSignInAt: '2026-10-10T00:00:00Z',
    });
    expect(used.used).toBe(true);
  });

  it('an unused code has no redeemer', () => {
    const fresh = mapLedgerRow(row());
    expect(fresh.redeemer).toBeNull();
    expect(fresh.used).toBe(false);
  });

  it('a code whose woman was erased still reads as used, with no name', () => {
    const erased = mapLedgerRow(
      row({ redeemed_at: '2026-10-03T08:00:00Z', redeemer_status: 'account_deleted' }),
    );
    expect(erased.used).toBe(true);
    expect(erased.redeemer).toEqual({
      id: null,
      displayName: null,
      username: null,
      redeemedAt: '2026-10-03T08:00:00Z',
      status: 'account_deleted',
      lastSignInAt: null,
    });
  });
});

describe('codeState', () => {
  it('a used code is used, whatever its expiry', () => {
    expect(codeState(mapLedgerRow(row({ redeemed_at: '2026-10-03T08:00:00Z', redeemed_by: 'u' })), NOW)).toBe('used');
  });
  it('revoked beats locked beats expired beats active', () => {
    expect(codeState(mapLedgerRow(row({ revoked_at: '2026-10-02T00:00:00Z', locked_at: '2026-10-02T00:00:00Z' })), NOW)).toBe('revoked');
    expect(codeState(mapLedgerRow(row({ locked_at: '2026-10-02T00:00:00Z' })), NOW)).toBe('locked');
    expect(codeState(mapLedgerRow(row({ expires_at: '2026-10-05T00:00:00Z' })), NOW)).toBe('expired');
    expect(codeState(mapLedgerRow(row()), NOW)).toBe('active');
  });
});

describe('openCodeCount', () => {
  it('counts only her own unused, working invite codes (what the cap counts)', () => {
    const codes = [
      row(), // open
      row({ code_id: 'c2' }), // open
      row({ code_id: 'c3', redeemed_by: 'u', redeemed_at: '2026-10-03T00:00:00Z' }), // used
      row({ code_id: 'c4', revoked_at: '2026-10-02T00:00:00Z' }), // revoked
      row({ code_id: 'c5', expires_at: '2026-10-05T00:00:00Z' }), // expired
      row({ code_id: 'c6', minted_by: 'someone-else' }), // not hers
      row({ code_id: 'c7', kind: 'review' }), // store review code, never capped
    ].map(mapLedgerRow);
    expect(openCodeCount(codes, 'admin-1', NOW)).toBe(2);
  });
});

describe('memberStatusLabel', () => {
  it('says where her membership stands in words', () => {
    expect(memberStatusLabel('approved')).toBe('Member');
    expect(memberStatusLabel('pending')).toBe('Application in review');
    expect(memberStatusLabel('rejected')).toBe('Not approved');
    expect(memberStatusLabel('suspended')).toBe('Suspended');
    expect(memberStatusLabel('deleted')).toBe('Deleted her account');
    expect(memberStatusLabel('account_deleted')).toBe('Account erased');
    expect(memberStatusLabel(null)).toBe('—');
    expect(memberStatusLabel('something_new')).toBe('something_new');
  });
});
