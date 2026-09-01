import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ReportsQueueClient,
  type ReportItem,
} from '@/app/(dashboard)/staff/archive/reports/ReportsQueueClient';

const mockInvokeFunction = jest.fn();
jest.mock('@/lib/supabase/invokeFunction', () => ({
  invokeFunction: (...args: unknown[]) => mockInvokeFunction(...args),
}));
jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn(() => ({})) }));
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: mockRefresh })) }));

const ENTRY_REPORT: ReportItem = {
  id: 'rep-1',
  reason: 'archive_bad_entry',
  detail: 'This is not actually a WLW film.',
  contentType: 'archive_entry',
  contentId: 'entry-1',
  createdAt: '2026-08-20T00:00:00Z',
  entryTitle: 'Some Film',
  entryAlreadyHidden: false,
  reviewAlreadyRemoved: false,
  unresolvedContent: false,
};

const REVIEW_REPORT: ReportItem = {
  ...ENTRY_REPORT,
  id: 'rep-2',
  reason: 'archive_review_abuse',
  contentType: 'archive_review',
  contentId: 'review-1',
};

describe('ReportsQueueClient', () => {
  const originalConfirm = window.confirm;
  beforeEach(() => {
    mockInvokeFunction.mockReset();
    mockRefresh.mockReset();
    window.confirm = jest.fn(() => true);
  });
  afterAll(() => {
    window.confirm = originalConfirm;
  });

  it('renders an honest empty state', () => {
    render(<ReportsQueueClient reports={[]} />);
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('labels the reason and shows the reporter note when opened', () => {
    render(<ReportsQueueClient reports={[ENTRY_REPORT]} />);
    expect(screen.getByText('Bad entry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText('This is not actually a WLW film.')).toBeInTheDocument();
  });

  it('keeps hide-entry disabled until a note of at least 10 characters is typed', () => {
    render(<ReportsQueueClient reports={[ENTRY_REPORT]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    const hideButton = screen.getByRole('button', { name: /hide entry/i });
    expect(hideButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'Confirmed not WLW.' } });
    expect(hideButton).not.toBeDisabled();
  });

  it('confirms before hiding an entry, then calls the resolve action honestly', async () => {
    mockInvokeFunction.mockResolvedValue({ data: { ok: true }, error: null });
    render(<ReportsQueueClient reports={[ENTRY_REPORT]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'Confirmed not WLW.' } });
    fireEvent.click(screen.getByRole('button', { name: /hide entry/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockInvokeFunction).toHaveBeenCalledWith(
        {},
        'staff-resolve-archive-report',
        expect.objectContaining({ report_id: 'rep-1', action: 'hide_entry' }),
      );
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows remove-review, not hide-entry, for a review-content report', () => {
    render(<ReportsQueueClient reports={[REVIEW_REPORT]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByRole('button', { name: /remove review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hide entry/i })).not.toBeInTheDocument();
  });

  it('never reports success when the resolve function fails — no false positive', async () => {
    mockInvokeFunction.mockResolvedValue({ data: null, error: 'not found', status: 404 });
    render(<ReportsQueueClient reports={[ENTRY_REPORT]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'Confirmed not WLW.' } });
    fireEvent.click(screen.getByRole('button', { name: /hide entry/i }));

    await waitFor(() => {
      expect(screen.getByText(/not switched on/i)).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not act if the hide confirmation is declined', () => {
    window.confirm = jest.fn(() => false);
    render(<ReportsQueueClient reports={[ENTRY_REPORT]} />);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'Confirmed not WLW.' } });
    fireEvent.click(screen.getByRole('button', { name: /hide entry/i }));
    expect(mockInvokeFunction).not.toHaveBeenCalled();
  });

  it('offers only dismiss when the reported content could not be resolved', () => {
    render(
      <ReportsQueueClient
        reports={[{ ...ENTRY_REPORT, contentType: 'unknown', unresolvedContent: true }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss report/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hide entry/i })).not.toBeInTheDocument();
  });
});
