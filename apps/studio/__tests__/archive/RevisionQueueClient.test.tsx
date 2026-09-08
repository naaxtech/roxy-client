import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  RevisionQueueClient,
  edgeFunctionErrorMessage,
  type RevisionItem,
} from '@/app/(dashboard)/staff/archive/revisions/RevisionQueueClient';

const mockInvokeFunction = jest.fn();
jest.mock('@/lib/supabase/invokeFunction', () => ({
  invokeFunction: (...args: unknown[]) => mockInvokeFunction(...args),
}));
jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn(() => ({})) }));
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: jest.fn() })) }));

const PENDING: RevisionItem = {
  id: 'rev-1',
  entryId: 'entry-1',
  entryTitle: 'Portrait of a Lady on Fire',
  entrySlug: 'portrait-of-a-lady-on-fire',
  submittedByName: 'A member',
  patch: { summary: 'A new spoiler-free summary.' },
  prev: { summary: 'The old summary.' },
  kind: 'edit',
  status: 'pending',
  reviewNote: null,
  createdAt: '2026-08-20T00:00:00Z',
};

const APPLIED: RevisionItem = {
  ...PENDING,
  id: 'rev-2',
  status: 'approved',
};

describe('edgeFunctionErrorMessage', () => {
  it('returns empty string when there is no error', () => {
    expect(edgeFunctionErrorMessage(null, undefined)).toBe('');
  });

  it('maps a 404 (function not deployed) to an honest "not switched on" message', () => {
    expect(edgeFunctionErrorMessage('not found', 404)).toMatch(/not switched on/i);
  });

  it('passes through any other server error verbatim', () => {
    expect(edgeFunctionErrorMessage('revision already decided', 409)).toBe(
      'revision already decided',
    );
  });
});

describe('RevisionQueueClient — pending mode', () => {
  beforeEach(() => mockInvokeFunction.mockReset());

  it('renders an honest empty state', () => {
    render(<RevisionQueueClient mode="pending" revisions={[]} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText(/no revisions are waiting/i)).toBeInTheDocument();
  });

  it('shows the side-by-side diff only for patched fields when opened', () => {
    render(<RevisionQueueClient mode="pending" revisions={[PENDING]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText('The old summary.')).toBeInTheDocument();
    expect(screen.getByText('A new spoiler-free summary.')).toBeInTheDocument();
  });

  it('blocks a reject with a review note under 10 characters', async () => {
    render(<RevisionQueueClient mode="pending" revisions={[PENDING]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByLabelText(/review note/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    // The button itself no-ops below the length threshold (guarded in the card).
    await waitFor(() => expect(mockInvokeFunction).not.toHaveBeenCalled());
  });

  it('approves via staff-review-archive-revision with the documented contract', async () => {
    mockInvokeFunction.mockResolvedValue({ data: { ok: true }, error: null });
    render(<RevisionQueueClient mode="pending" revisions={[PENDING]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(mockInvokeFunction).toHaveBeenCalledWith(
        {},
        'staff-review-archive-revision',
        expect.objectContaining({ revision_id: 'rev-1', decision: 'approved' }),
      );
    });
  });

  it('surfaces a 404 from the edge function honestly instead of claiming success', async () => {
    mockInvokeFunction.mockResolvedValue({ data: null, error: 'not found', status: 404 });
    render(<RevisionQueueClient mode="pending" revisions={[PENDING]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(screen.getByText(/not switched on/i)).toBeInTheDocument();
    });
  });
});

describe('RevisionQueueClient — decided mode (revert)', () => {
  const originalConfirm = window.confirm;
  beforeEach(() => {
    mockInvokeFunction.mockReset();
    window.confirm = jest.fn(() => true);
  });
  afterAll(() => {
    window.confirm = originalConfirm;
  });

  it('renders an honest empty state', () => {
    render(<RevisionQueueClient mode="decided" revisions={[]} />);
    expect(screen.getByText(/no revisions have been applied/i)).toBeInTheDocument();
  });

  it('keeps revert disabled until a reason is entered', () => {
    render(<RevisionQueueClient mode="decided" revisions={[APPLIED]} />);
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(screen.getByRole('button', { name: /revert to previous state/i })).toBeDisabled();
  });

  it('confirms before reverting, and sends decision: reverted', async () => {
    mockInvokeFunction.mockResolvedValue({ data: { ok: true }, error: null });
    render(<RevisionQueueClient mode="decided" revisions={[APPLIED]} />);
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    fireEvent.change(screen.getByLabelText(/reason for reverting/i), {
      target: { value: 'This broke the entry title.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /revert to previous state/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockInvokeFunction).toHaveBeenCalledWith(
        {},
        'staff-review-archive-revision',
        expect.objectContaining({ revision_id: 'rev-2', decision: 'reverted' }),
      );
    });
  });

  it('does not call the backend if the confirmation is declined', () => {
    window.confirm = jest.fn(() => false);
    render(<RevisionQueueClient mode="decided" revisions={[APPLIED]} />);
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    fireEvent.change(screen.getByLabelText(/reason for reverting/i), {
      target: { value: 'This broke the entry title.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /revert to previous state/i }));
    expect(mockInvokeFunction).not.toHaveBeenCalled();
  });
});
