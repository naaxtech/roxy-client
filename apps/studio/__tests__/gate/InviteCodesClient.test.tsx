import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InviteCodesClient, createErrorMessage } from '@/app/(dashboard)/invites/InviteCodesClient';
import { mapLedgerRow, type LedgerRow } from '@/lib/inviteLedger';
import { formatUtcDate } from '@/lib/dates';

const mockInsert = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    from: () => ({
      insert: (payload: unknown) => {
        mockInsert(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { code: 'NEWC0DE1', expires_at: null }, error: null }),
          }),
        };
      },
      update: (payload: unknown) => {
        mockUpdate(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  })),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: jest.fn() })),
}));

const NOW = '2026-10-11T12:00:00.000Z';

function ledger(over: Partial<LedgerRow>): LedgerRow {
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

const USED = mapLedgerRow(
  ledger({
    code_id: 'c2',
    code: 'USED2345',
    redeemed_by: 'u-9',
    redeemer_name: 'Maya Lopez',
    redeemer_username: 'mayal',
    redeemed_at: '2026-10-03T08:00:00Z',
    redeemer_status: 'pending',
    redeemer_last_sign_in: '2026-10-10T00:00:00Z',
  }),
);
const OPEN = mapLedgerRow(ledger({}));

function renderClient(over: Partial<React.ComponentProps<typeof InviteCodesClient>> = {}) {
  return render(
    <InviteCodesClient
      userId="admin-1"
      isStaff={false}
      quotaOk
      communities={[{ id: 'k1', name: 'Book Club' }]}
      codes={[OPEN, USED]}
      codesFailedToLoad={false}
      truncated={false}
      nowIso={NOW}
      {...over}
    />,
  );
}

beforeEach(() => {
  mockInsert.mockClear();
  mockUpdate.mockClear();
});

describe('InviteCodesClient — one code, one woman', () => {
  it('shows who minted each code and, once used, who used it and where she stands', () => {
    renderClient();
    fireEvent.click(screen.getByLabelText(/Show the 1 revoked, expired and used/i));
    const row = screen.getByTestId('invite-row-c2');
    expect(within(row).getByText('Ana')).toBeTruthy();
    expect(within(row).getByText('@ana')).toBeTruthy();
    expect(within(row).getByText('Maya Lopez')).toBeTruthy();
    expect(within(row).getByText('@mayal')).toBeTruthy();
    expect(within(row).getByText('Application in review')).toBeTruthy();
    expect(within(row).getByText(`Used ${formatUtcDate('2026-10-03T08:00:00Z')}`)).toBeTruthy();
    expect(within(row).getByText(`Last signed in ${formatUtcDate('2026-10-10T00:00:00Z')}`)).toBeTruthy();
  });

  it('offers no shareable or multi-use code, and mints exactly one use', async () => {
    renderClient();
    expect(screen.queryByText(/Shareable code/i)).toBeNull();
    expect(screen.queryByLabelText(/Number of uses/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Create a code for her/i }));
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    expect(mockInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ community_id: 'k1', created_by: 'admin-1', max_uses: 1 }),
    );
  });

  it('an admin at her cap is told so and cannot mint', () => {
    renderClient({ quotaOk: false });
    expect(screen.getByTestId('invite-cap-reached')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Create a code for her/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('staff see no cap message even with many open codes', () => {
    renderClient({ isStaff: true, quotaOk: true });
    expect(screen.queryByTestId('invite-cap-reached')).toBeNull();
    expect(screen.getByText(/Staff codes are not capped/i)).toBeTruthy();
  });

  it('a used code cannot be revoked (there is nothing left to stop)', () => {
    renderClient();
    fireEvent.click(screen.getByLabelText(/Show the 1 revoked, expired and used/i));
    expect(screen.queryByRole('button', { name: 'Revoke invite code USED2345' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke invite code ABCD2345' })).toBeTruthy();
  });
});

describe('createErrorMessage', () => {
  it('names the cap when the database refuses an admin over it', () => {
    expect(
      createErrorMessage({
        code: '23514',
        message: 'You already have 10 unused codes. Revoke one, or wait until one is used.',
        details: '',
        hint: '',
        name: 'PostgrestError',
      }),
    ).toMatch(/10 unused codes/);
  });
  it('explains a refusal without Postgres words', () => {
    expect(
      createErrorMessage({ code: '42501', message: 'new row violates row-level security policy', details: '', hint: '', name: 'PostgrestError' }),
    ).toMatch(/approved, active admin of this community/);
  });
});
