import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReviewCodeMint } from '@/app/(dashboard)/invites/ReviewCodeMint';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: jest.fn() })),
}));

/**
 * G-22: core staff mint a single-use store review code from Studio, so the
 * runbook (docs/ops/store-review-account.md) needs no SQL. The RPC
 * (mint_review_code, migration 134) refuses anyone but core; the code still
 * only opens an application, which staff approve in the review queue.
 */
describe('ReviewCodeMint', () => {
  beforeEach(() => mockRpc.mockReset());

  it('mints one review code with the label and shows it once', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'REVW2345', error: null });
    render(<ReviewCodeMint />);
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'App Store review 2026-10' } });
    fireEvent.click(screen.getByRole('button', { name: /Create store review code/i }));
    await waitFor(() => expect(screen.getByText('REVW2345')).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('mint_review_code', { p_label: 'App Store review 2026-10', p_days: 30 });
  });

  it('asks for a label before calling the database', () => {
    render(<ReviewCodeMint />);
    fireEvent.click(screen.getByRole('button', { name: /Create store review code/i }));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/label/i);
  });

  it('says plainly when the database refuses (not core)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'only Roxy core can mint a store review code' } });
    render(<ReviewCodeMint />);
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'Play review' } });
    fireEvent.click(screen.getByRole('button', { name: /Create store review code/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Only Roxy core/));
  });
});
