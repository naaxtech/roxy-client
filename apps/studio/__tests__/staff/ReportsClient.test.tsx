import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ReportsClient, type ReportView } from '@/app/(dashboard)/staff/reports/ReportsClient';

const mockResolve = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/app/(dashboard)/staff/reports/actions', () => ({
  resolveReport: (...args: unknown[]) => mockResolve(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: mockRefresh })),
}));

function report(overrides: Partial<ReportView> = {}): ReportView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    contentType: 'post',
    contentId: '22222222-2222-4222-8222-222222222222',
    reason: 'harassment',
    detail: 'She keeps posting about me',
    status: 'pending',
    createdLabel: '1 Oct 2026, 10:00 UTC',
    reporterName: 'Maya',
    reportedName: 'Jess',
    reportedUserId: '33333333-3333-4333-8333-333333333333',
    preview: 'a mean post',
    contentGone: false,
    sameTargetPending: 1,
    resolvedLabel: null,
    resolvedByName: null,
    resolutionNote: null,
    resolutionAction: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockResolve.mockReset();
  mockRefresh.mockReset();
});

describe('ReportsClient', () => {
  it('lists reports and opens the first one with reporter and reported names', () => {
    render(<ReportsClient reports={[report(), report({ id: 'r2', contentType: 'message', reason: 'spam' })]} resolutionLive />);
    expect(screen.getAllByRole('button', { name: /open report/i })).toHaveLength(2);
    const detail = screen.getByRole('region', { name: /report detail/i });
    expect(within(detail).getByText('Maya')).toBeInTheDocument();
    expect(within(detail).getByText('Jess')).toBeInTheDocument();
    expect(within(detail).getByText('a mean post')).toBeInTheDocument();
  });

  it('offers Hide only for content the server can hide', () => {
    const { rerender } = render(<ReportsClient reports={[report()]} resolutionLive />);
    expect(screen.getByRole('button', { name: 'Hide content' })).toBeInTheDocument();
    rerender(<ReportsClient reports={[report({ contentType: 'message' })]} resolutionLive />);
    expect(screen.queryByRole('button', { name: 'Hide content' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action + suspend' })).toBeInTheDocument();
  });

  it('dismisses through the server action and shows what the server did', async () => {
    mockResolve.mockResolvedValue({ ok: true, message: 'Dismissed 1 report.' });
    render(<ReportsClient reports={[report()]} resolutionLive />);
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'not a violation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dismissed 1 report.'));
    expect(mockResolve).toHaveBeenCalledWith(report().id, 'dismiss', 'not a violation');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the server refusal and does not refresh', async () => {
    mockResolve.mockResolvedValue({ ok: false, error: 'This report was already resolved by someone else.' });
    render(<ReportsClient reports={[report()]} resolutionLive />);
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This report was already resolved by someone else.'),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('asks before suspending, and does nothing if staff backs out', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ReportsClient reports={[report()]} resolutionLive />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide + suspend' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Jess'));
    expect(mockResolve).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    mockResolve.mockResolvedValue({ ok: true, message: 'Actioned 1 report. The content is hidden. The member is suspended.' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide + suspend' }));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith(report().id, 'hide_suspend', ''));
    confirmSpy.mockRestore();
  });

  it('shows the outcome instead of actions for a resolved report', () => {
    render(
      <ReportsClient
        reports={[report({ status: 'dismissed', resolvedLabel: '2 Oct 2026, 09:00 UTC', resolvedByName: 'Nicole', resolutionNote: 'fine' })]}
        resolutionLive
      />,
    );
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.getByText(/Nicole/)).toBeInTheDocument();
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('disables actions while migration 131 is missing', () => {
    render(<ReportsClient reports={[report()]} resolutionLive={false} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
  });

  it('says how many reports point at the same content', () => {
    render(<ReportsClient reports={[report({ sameTargetPending: 3 })]} resolutionLive />);
    expect(screen.getAllByText(/3 pending reports on this/i).length).toBeGreaterThan(0);
  });
});
