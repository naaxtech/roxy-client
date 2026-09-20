import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeedbackClient, type Feedback } from '@/app/(dashboard)/staff/feedback/FeedbackClient';

jest.mock('@/app/(dashboard)/staff/feedback/actions', () => ({
  updateFeedbackStatus: jest.fn(),
  updateFeedbackNotes: jest.fn(),
}));

const REPORT: Feedback = {
  id: 'fb-1',
  user_id: 'u-1',
  category: 'broken',
  rating: null,
  message: 'The Archive search is blank.',
  screen_context: 'archive',
  app_version: '3.0.0',
  platform: 'ios',
  status: 'open',
  internal_notes: null,
  created_at: '2026-09-07T03:10:00.000Z',
  reporterName: 'Jo',
  reporterEmail: 'jo@example.com',
};

describe('FeedbackClient', () => {
  it('shows who reported, when, and a reply mailto', () => {
    render(<FeedbackClient initialFeedback={[REPORT]} />);

    expect(screen.getByText('Jo')).toBeInTheDocument();
    expect(screen.getByText(/Sep 7, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/03:10/)).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /email jo/i });
    expect(link.getAttribute('href')).toMatch(/^mailto:/);
    expect(link.getAttribute('href')).toContain('jo%40example.com');
  });

  it('does not invent an email when none is on file', () => {
    render(
      <FeedbackClient initialFeedback={[{ ...REPORT, reporterEmail: null, reporterName: 'Member' }]} />,
    );
    expect(screen.queryByRole('link', { name: /email/i })).toBeNull();
    expect(screen.getByText(/no email on file/i)).toBeInTheDocument();
  });

  it('filters the inbox as you type', () => {
    render(
      <FeedbackClient
        initialFeedback={[
          REPORT,
          { ...REPORT, id: 'fb-2', message: 'Checkout never finishes.', reporterName: 'Ari' },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/search reports/i), { target: { value: 'checkout' } });
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.queryByText('Jo')).not.toBeInTheDocument();
  });
});
