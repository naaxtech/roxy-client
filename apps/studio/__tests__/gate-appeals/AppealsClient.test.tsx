import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  AppealsClient,
  GrandfatheredList,
  type AppealItem,
  type GrandfatheredItem,
} from '@/app/(dashboard)/staff/appeals/AppealsClient';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: mockRefresh })) }));

const NOW = new Date('2026-10-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const OPEN: AppealItem = {
  id: 'ap-1',
  applicationId: 'app-1',
  appeal: 'I was invited by my climbing partner, she can vouch for me.',
  requestedAt: hoursAgo(60),
  resolvedAt: null,
  outcome: null,
  communityName: 'Leeds WLW',
  rejectionReason: 'not_known',
};
const RESOLVED: AppealItem = {
  ...OPEN,
  id: 'ap-2',
  applicationId: 'app-2',
  requestedAt: hoursAgo(300),
  resolvedAt: hoursAgo(200),
  outcome: 'upheld',
};

const GF: GrandfatheredItem[] = [
  { userId: 'u-1', displayName: 'Robin', username: 'robin', joinedAt: hoursAgo(5000), reviewed: false },
  { userId: 'u-2', displayName: null, username: 'kit', joinedAt: hoursAgo(6000), reviewed: true },
];

describe('AppealsClient (G-12)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
  });

  it('shows an honest empty state', () => {
    render(<AppealsClient appeals={[]} now={NOW} />);
    expect(screen.getByText('No open appeals')).toBeInTheDocument();
  });

  it('lists open appeals with her words, the original reason and an SLA badge', () => {
    render(<AppealsClient appeals={[OPEN, RESOLVED]} now={NOW} />);
    const row = screen.getByTestId('appeal-ap-1');
    expect(within(row).getByText(OPEN.appeal)).toBeInTheDocument();
    expect(within(row).getByText(/doesn’t know her/)).toBeInTheDocument();
    expect(within(row).getByTestId('wait-badge')).toHaveAttribute('data-tone', 'overdue');
    // Resolved ones are history, not work.
    expect(screen.getByTestId('appeal-ap-2')).toHaveTextContent(/upheld/i);
    expect(within(screen.getByTestId('appeal-ap-2')).queryByRole('button', { name: /overturn/i })).toBeNull();
  });

  it('keeps both decisions disabled until a 10-character note is written', () => {
    render(<AppealsClient appeals={[OPEN]} now={NOW} />);
    const row = screen.getByTestId('appeal-ap-1');
    const overturn = within(row).getByRole('button', { name: /overturn/i });
    const uphold = within(row).getByRole('button', { name: /uphold/i });
    expect(overturn).toBeDisabled();
    expect(uphold).toBeDisabled();
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Partner vouched by DM.' } });
    expect(overturn).not.toBeDisabled();
    expect(uphold).not.toBeDisabled();
  });

  it('overturns through resolve_appeal after a confirm', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    render(<AppealsClient appeals={[OPEN]} now={NOW} />);
    const row = screen.getByTestId('appeal-ap-1');
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Partner vouched by DM.' } });
    fireEvent.click(within(row).getByRole('button', { name: /overturn/i }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('resolve_appeal', {
        p_appeal_id: 'ap-1',
        p_outcome: 'overturned',
        p_note: 'Partner vouched by DM.',
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it('upholds through resolve_appeal and shows a server refusal as a sentence', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'appeal already resolved' } });
    render(<AppealsClient appeals={[OPEN]} now={NOW} />);
    const row = screen.getByTestId('appeal-ap-1');
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Nothing new in it.' } });
    fireEvent.click(within(row).getByRole('button', { name: /uphold/i }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('resolve_appeal', {
        p_appeal_id: 'ap-1',
        p_outcome: 'upheld',
        p_note: 'Nothing new in it.',
      }),
    );
    expect(await screen.findByText('Someone else has already resolved this appeal.')).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('does nothing when the confirm is dismissed', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AppealsClient appeals={[OPEN]} now={NOW} />);
    const row = screen.getByTestId('appeal-ap-1');
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Partner vouched by DM.' } });
    fireEvent.click(within(row).getByRole('button', { name: /overturn/i }));
    expect(mockRpc).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe('GrandfatheredList (G-23)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
  });

  it('marks every pre-gate member "review optional" and shows who is already reviewed', () => {
    render(<GrandfatheredList members={GF} />);
    const robin = screen.getByTestId('grandfathered-u-1');
    expect(within(robin).getByText('Review optional')).toBeInTheDocument();
    expect(within(robin).getByRole('button', { name: /keep/i })).toBeInTheDocument();
    const kit = screen.getByTestId('grandfathered-u-2');
    expect(within(kit).getByText('Reviewed')).toBeInTheDocument();
    expect(within(kit).queryByRole('button', { name: /keep/i })).toBeNull();
  });

  it('keeps a member through review_grandfathered_member with no note needed', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    render(<GrandfatheredList members={GF} />);
    fireEvent.click(within(screen.getByTestId('grandfathered-u-1')).getByRole('button', { name: /keep/i }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('review_grandfathered_member', {
        p_user_id: 'u-1',
        p_keep: true,
        p_note: null,
      }),
    );
  });

  it('sending someone to the waiting room needs a note and a confirm', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    render(<GrandfatheredList members={GF} />);
    const row = screen.getByTestId('grandfathered-u-1');
    const revoke = within(row).getByRole('button', { name: /waiting room/i });
    expect(revoke).toBeDisabled();
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Nobody can say who this is.' } });
    fireEvent.click(revoke);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('review_grandfathered_member', {
        p_user_id: 'u-1',
        p_keep: false,
        p_note: 'Nobody can say who this is.',
      }),
    );
    confirm.mockRestore();
  });
});
