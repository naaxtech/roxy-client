import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlockPayoutButton } from '@/app/(dashboard)/staff/BlockPayoutButton';
import { ReleasePayoutButton } from '@/app/(dashboard)/staff/ReleasePayoutButton';

const mockSetBlock = jest.fn();
const mockRelease = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/app/(dashboard)/staff/payout-actions', () => ({
  setPayoutBlock: (...args: unknown[]) => mockSetBlock(...args),
  releasePayout: (...args: unknown[]) => mockRelease(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: mockRefresh })),
}));

const EVENT = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

beforeEach(() => {
  mockSetBlock.mockReset();
  mockRelease.mockReset();
  mockRefresh.mockReset();
});

describe('BlockPayoutButton', () => {
  it('renders nothing actionable for non-core staff', () => {
    render(<BlockPayoutButton eventId={EVENT} canManage={false} />);
    expect(screen.queryByRole('button', { name: /block/i })).not.toBeInTheDocument();
    expect(screen.getByText(/core staff/i)).toBeInTheDocument();
  });

  it('requires a reason and reports the real server result', async () => {
    mockSetBlock.mockResolvedValue({ ok: true, message: 'This payout was already blocked. Nothing changed.' });
    render(<BlockPayoutButton eventId={EVENT} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Block payout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/reason/i);
    expect(mockSetBlock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'chargeback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('This payout was already blocked. Nothing changed.'),
    );
    expect(mockSetBlock).toHaveBeenCalledWith(EVENT, true, 'chargeback');
  });

  it('shows a refusal instead of success', async () => {
    mockSetBlock.mockResolvedValue({ ok: false, error: 'Only core staff can change a payout.' });
    render(<BlockPayoutButton eventId={EVENT} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Block payout' }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'chargeback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only core staff can change a payout.'));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('unblocks a blocked payout through the same RPC', async () => {
    mockSetBlock.mockResolvedValue({ ok: true, message: 'Payout unblocked.' });
    render(<BlockPayoutButton eventId={EVENT} canManage blocked />);
    fireEvent.click(screen.getByRole('button', { name: 'Unblock payout' }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'dispute won' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unblock' }));
    await waitFor(() => expect(mockSetBlock).toHaveBeenCalledWith(EVENT, false, 'dispute won'));
  });
});

describe('ReleasePayoutButton', () => {
  it('is hidden from non-core staff', () => {
    render(<ReleasePayoutButton eventId={EVENT} canManage={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reports a skipped release as not released', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRelease.mockResolvedValue({ ok: false, error: 'Not released. The event is not completed…' });
    render(<ReleasePayoutButton eventId={EVENT} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Release payout' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Not released/));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('reports a real release', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRelease.mockResolvedValue({ ok: true, message: 'Payout released to the host.' });
    render(<ReleasePayoutButton eventId={EVENT} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Release payout' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Payout released to the host.'));
    expect(mockRelease).toHaveBeenCalledWith(EVENT);
    expect(mockRefresh).toHaveBeenCalled();
  });
});
