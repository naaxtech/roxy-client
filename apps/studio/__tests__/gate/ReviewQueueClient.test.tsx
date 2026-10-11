import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  ReviewQueueClient,
  ReviewerAgreement,
  type QueueItem,
} from '@/app/(dashboard)/applications/ReviewQueueClient';

const mockRpc = jest.fn();
const mockUpsert = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ upsert: (...args: unknown[]) => mockUpsert(...args) }),
  })),
}));
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: mockRefresh })) }));

const NOW = new Date('2026-10-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const APPS: QueueItem[] = [
  { id: 'app-old', communityName: 'Leeds WLW', readyAt: hoursAgo(50), score: 2 },
  { id: 'app-mid', communityName: 'Leeds WLW', readyAt: hoursAgo(30), score: 4 },
  { id: 'app-new', communityName: 'Cebu WLW', readyAt: hoursAgo(5), score: 1 },
];

const CONTEXT = {
  application: {
    id: 'app-old', status: 'pending', submitted_at: hoursAgo(60), ready_at: hoursAgo(50),
    decided_at: null, decision_reason: null, community_name: 'Leeds WLW',
  },
  applicant: {
    display_name: 'Sam', username: 'sam_l', avatar_url: null, pronouns: ['she', 'her'],
    identity_labels: ['lesbian'], bio: 'Climber, reader.', onboarding_completed: true,
    account_created_at: hoursAgo(70),
  },
  answers: [
    { key: 'join_reason', label: 'Why Roxy', prompt: 'Why do you want to join?',
      answer: 'A friend from the climbing group told me about it and I want to meet people.',
      answered_at: hoursAgo(55) },
  ],
  criteria_met: ['Why Roxy'],
  missing_required: [],
  legal_name_on_file: true,
  id_check: { status: 'approved', decided_at: hoursAgo(52), duplicate_signal: false },
  code: { label: 'Climbing night', is_member_code: false, minted_by: 'Jo' },
  appeal: null,
  history: [{ decision: 'grandfathered', reason: null, at: hoursAgo(400) }],
};

function renderQueue(props: Partial<React.ComponentProps<typeof ReviewQueueClient>> = {}) {
  return render(
    <ReviewQueueClient applications={APPS} canRevealNames={false} now={NOW} {...props} />,
  );
}

async function openFirst() {
  mockRpc.mockResolvedValueOnce({ data: CONTEXT, error: null });
  const row = screen.getByTestId('application-app-old');
  fireEvent.click(within(row).getByRole('button', { name: /review/i }));
  await screen.findByText(/A friend from the climbing group/);
  return row;
}

describe('ReviewQueueClient — SLA (G-10)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
  });

  it('shows an honest empty state', () => {
    renderQueue({ applications: [] });
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('badges each application by how long she has waited since she sent it', () => {
    renderQueue();
    expect(within(screen.getByTestId('application-app-old')).getByTestId('wait-badge')).toHaveTextContent(
      '2d 2h · overdue',
    );
    expect(within(screen.getByTestId('application-app-old')).getByTestId('wait-badge')).toHaveAttribute(
      'data-tone',
      'overdue',
    );
    expect(within(screen.getByTestId('application-app-mid')).getByTestId('wait-badge')).toHaveAttribute(
      'data-tone',
      'due',
    );
    expect(within(screen.getByTestId('application-app-new')).getByTestId('wait-badge')).toHaveAttribute(
      'data-tone',
      'ontime',
    );
  });

  it('summarises how many are overdue', () => {
    renderQueue();
    expect(screen.getByText(/1 overdue/)).toBeInTheDocument();
  });
});

describe('ReviewQueueClient — reviewer context (G-13)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
  });

  it('loads the full context through application_review_context when opened', async () => {
    renderQueue();
    const row = await openFirst();
    expect(mockRpc).toHaveBeenCalledWith('application_review_context', { p_application_id: 'app-old' });
    const ctx = within(row);
    expect(ctx.getByText('Why do you want to join?')).toBeInTheDocument();
    expect(ctx.getByText('Verified')).toBeInTheDocument();
    expect(ctx.getByText(/Climbing night/)).toBeInTheDocument();
    expect(ctx.getByText(/minted by Jo/i)).toBeInTheDocument();
    expect(ctx.getByText('she/her')).toBeInTheDocument();
    expect(ctx.getByText(/Grandfathered \(joined before the gate\)/)).toBeInTheDocument();
  });

  it('says so when the context cannot load, instead of showing an empty card', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    renderQueue();
    const row = screen.getByTestId('application-app-old');
    fireEvent.click(within(row).getByRole('button', { name: /review/i }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('warns when required answers are missing', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...CONTEXT, answers: [], missing_required: ['join_reason'] },
      error: null,
    });
    renderQueue();
    const row = screen.getByTestId('application-app-old');
    fireEvent.click(within(row).getByRole('button', { name: /review/i }));
    expect(await within(row).findByText(/missing a required answer/i)).toBeInTheDocument();
  });

  it('only offers the legal-name reveal to staff reviewers', async () => {
    const { unmount } = renderQueue({ canRevealNames: false });
    let row = await openFirst();
    expect(within(row).queryByRole('button', { name: /reveal/i })).toBeNull();
    unmount();
    renderQueue({ canRevealNames: true });
    row = await openFirst();
    expect(within(row).getByRole('button', { name: /reveal/i })).toBeInTheDocument();
  });
});

describe('ReviewQueueClient — decisions through decide_application (130)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
  });

  it('approves with no reason category', async () => {
    renderQueue();
    const row = await openFirst();
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(within(row).getByRole('button', { name: /^approve$/i }));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenLastCalledWith('decide_application', {
        p_application_id: 'app-old',
        p_decision: 'approved',
        p_note: null,
        p_reason: null,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('keeps Reject disabled until a reason category and a 10-character note are given', async () => {
    renderQueue();
    const row = await openFirst();
    const reject = within(row).getByRole('button', { name: /^reject$/i });
    expect(reject).toBeDisabled();
    // A note alone is not enough: she is told the category, never the note.
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Nobody at Leeds knows her.' } });
    expect(reject).toBeDisabled();
    fireEvent.change(within(row).getByLabelText(/reason category/i), { target: { value: 'not_known' } });
    expect(reject).not.toBeDisabled();
    // And a category with too short a note is not enough either.
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'short' } });
    expect(reject).toBeDisabled();
    fireEvent.change(within(row).getByLabelText(/note/i), { target: { value: 'Nobody at Leeds knows her.' } });

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(reject);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenLastCalledWith('decide_application', {
        p_application_id: 'app-old',
        p_decision: 'rejected',
        p_note: 'Nobody at Leeds knows her.',
        p_reason: 'not_known',
      }),
    );
  });

  it('shows the server refusal as a sentence', async () => {
    renderQueue();
    const row = await openFirst();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'application already decided' } });
    fireEvent.click(within(row).getByRole('button', { name: /^approve$/i }));
    expect(await screen.findByText('Someone else has already decided this one.')).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('ReviewerAgreement', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockUpsert.mockReset();
    mockRefresh.mockReset();
  });

  it('signs through sign_reviewer_agreement, never a direct table write (130 G-07)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    render(<ReviewerAgreement />);
    fireEvent.click(screen.getByLabelText(/I understand/i));
    fireEvent.click(screen.getByRole('button', { name: /start reviewing/i }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('sign_reviewer_agreement'));
    expect(mockUpsert).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
