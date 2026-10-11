import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteWaveClient } from '@/app/(dashboard)/staff/launch/waves/InviteWaveClient';

const mockCreate = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/app/(dashboard)/staff/launch/waves/actions', () => ({
  createInviteWave: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: mockRefresh })),
}));

const COMMUNITIES = [
  { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', name: 'Roxy Official' },
  { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', name: 'Book Club' },
];
const EXPIRY = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

let writeText: jest.Mock;
beforeEach(() => {
  mockCreate.mockReset();
  mockRefresh.mockReset();
  writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

function fill(count: string) {
  fireEvent.change(screen.getByLabelText(/how many codes/i), { target: { value: count } });
  fireEvent.change(screen.getByLabelText(/wave label/i), { target: { value: 'Wave 1' } });
  fireEvent.change(screen.getByLabelText(/expires/i), { target: { value: EXPIRY } });
}

describe('InviteWaveClient', () => {
  it('blocks an out-of-range count in the browser', () => {
    render(<InviteWaveClient communities={COMMUNITIES} />);
    fill('201');
    fireEvent.click(screen.getByRole('button', { name: /create codes/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/1 to 200/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the wave, lists every code, and copies them all as CSV', async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      communityName: 'Roxy Official',
      label: 'Wave 1',
      codes: [
        { code: 'ABCD2345', expiresAt: `${EXPIRY}T23:59:59.000Z` },
        { code: 'EFGH6789', expiresAt: `${EXPIRY}T23:59:59.000Z` },
      ],
    });
    render(<InviteWaveClient communities={COMMUNITIES} />);
    fill('2');
    fireEvent.change(screen.getByLabelText(/community/i), { target: { value: COMMUNITIES[1].id } });
    fireEvent.click(screen.getByRole('button', { name: /create codes/i }));

    await waitFor(() => expect(screen.getByText('ABCD2345')).toBeInTheDocument());
    expect(mockCreate).toHaveBeenCalledWith({
      count: '2',
      label: 'Wave 1',
      expiry: EXPIRY,
      communityId: COMMUNITIES[1].id,
    });
    expect(screen.getByText('EFGH6789')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 codes created for Roxy Official');

    fireEvent.click(screen.getByRole('button', { name: /copy all 2 codes as csv/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(
      `code,wave,community,expires_utc\r\nABCD2345,Wave 1,Roxy Official,${EXPIRY}\r\nEFGH6789,Wave 1,Roxy Official,${EXPIRY}`,
    );
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('shows the server refusal and no codes', async () => {
    mockCreate.mockResolvedValue({ ok: false, error: 'Roxy refused that batch.' });
    render(<InviteWaveClient communities={COMMUNITIES} />);
    fill('5');
    fireEvent.click(screen.getByRole('button', { name: /create codes/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Roxy refused that batch.'));
    expect(screen.queryByRole('button', { name: /copy all/i })).not.toBeInTheDocument();
  });

  it('says so when copying fails instead of pretending', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    mockCreate.mockResolvedValue({
      ok: true,
      communityName: 'Roxy Official',
      label: 'Wave 1',
      codes: [{ code: 'ABCD2345', expiresAt: null }],
    });
    render(<InviteWaveClient communities={COMMUNITIES} />);
    fill('1');
    fireEvent.click(screen.getByRole('button', { name: /create codes/i }));
    await screen.findByText('ABCD2345');
    fireEvent.click(screen.getByRole('button', { name: /copy all 1 code as csv/i }));
    expect(await screen.findByText(/copy did not work/i)).toBeInTheDocument();
  });
});
