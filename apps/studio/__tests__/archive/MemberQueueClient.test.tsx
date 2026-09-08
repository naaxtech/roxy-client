import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  MemberQueueClient,
  decideApplicationErrorMessage,
  type MemberQueueItem,
} from '@/app/(dashboard)/staff/archive/members/MemberQueueClient';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: jest.fn() })) }));

const APPS: MemberQueueItem[] = [
  { id: 'app-1', communityName: 'Manila WLW', submittedAt: '2026-08-01T00:00:00Z', score: 4 },
  { id: 'app-2', communityName: 'Cebu WLW', submittedAt: '2026-08-02T00:00:00Z', score: 2 },
];

describe('decideApplicationErrorMessage', () => {
  it('maps "already decided" to a plain-language explanation', () => {
    expect(decideApplicationErrorMessage('application already decided')).toMatch(
      /already decided/i,
    );
  });

  it('maps a not-authorised error without leaking the raw Postgres message', () => {
    const msg = decideApplicationErrorMessage('not authorised to decide this application');
    expect(msg).not.toMatch(/42501/);
    expect(msg.toLowerCase()).toContain('not authorised');
  });

  it('maps the reject-reason-length error', () => {
    expect(decideApplicationErrorMessage('a rejection requires a note of at least 10 characters')).toMatch(
      /10 characters/,
    );
  });

  it('falls back to a generic retry message for anything unrecognised', () => {
    expect(decideApplicationErrorMessage('duplicate key value violates constraint')).toBe(
      'Could not save that decision. Please try again.',
    );
  });
});

describe('MemberQueueClient', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('renders an honest empty state with no applications', () => {
    render(<MemberQueueClient applications={[]} />);
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('lists every pending application with its score', () => {
    render(<MemberQueueClient applications={APPS} />);
    expect(screen.getByText('Manila WLW', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Score 4')).toBeInTheDocument();
    expect(screen.getByText('Score 2')).toBeInTheDocument();
  });

  it('blocks a reject with a reason under 10 characters, without calling the RPC', async () => {
    render(<MemberQueueClient applications={[APPS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => {
      expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('approves a single application via decide_application', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(<MemberQueueClient applications={[APPS[0]]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('decide_application', {
        p_application_id: 'app-1',
        p_decision: 'approved',
        p_note: null,
      });
    });
  });

  it('bulk-approves every selected application and reports a mixed result honestly', async () => {
    mockRpc.mockImplementation((_fn: string, args: { p_application_id: string }) =>
      Promise.resolve(
        args.p_application_id === 'app-2'
          ? { error: { message: 'application already decided' } }
          : { error: null },
      ),
    );
    render(<MemberQueueClient applications={APPS} />);
    fireEvent.click(screen.getByLabelText('Select all applications'));
    fireEvent.click(screen.getByRole('button', { name: /approve 2 selected/i }));

    await waitFor(() => {
      expect(screen.getByText('Approved 1 of 2.')).toBeInTheDocument();
    });
    expect(screen.getByText(/already decided/i)).toBeInTheDocument();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('never calls bulk-approve on zero selected rows', () => {
    render(<MemberQueueClient applications={APPS} />);
    const button = screen.getByRole('button', { name: /approve selected/i });
    expect(button).toBeDisabled();
  });
});
