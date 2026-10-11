import React from 'react';
import { render, screen } from '@testing-library/react';
import { PendingApplicationsCardView } from '@/app/(dashboard)/staff/PendingApplicationsCard';

// The card's server half reads review_queue_stats(); only the view is under test.
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

describe('PendingApplicationsCardView (G-10)', () => {
  it('shows the count waiting and the oldest wait, red when past 48 hours', () => {
    render(
      <PendingApplicationsCardView
        stats={{ waiting: 3, overdue: 1, drafts: 2, oldest_hours: 50, open_appeals: 1, grandfathered_unreviewed: 6 }}
      />,
    );
    expect(screen.getByTestId('pending-applications-count')).toHaveTextContent('3');
    const oldest = screen.getByTestId('pending-applications-oldest');
    expect(oldest).toHaveTextContent('Oldest waiting 2 days');
    expect(oldest).toHaveAttribute('data-tone', 'overdue');
    expect(screen.getByText(/1 overdue/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review applications/i })).toHaveAttribute('href', '/applications');
    expect(screen.getByRole('link', { name: /1 open appeal/i })).toHaveAttribute('href', '/staff/appeals');
    expect(screen.getByText(/6 grandfathered/)).toBeInTheDocument();
  });

  it('is amber between 24 and 48 hours and green under 24', () => {
    const { rerender } = render(
      <PendingApplicationsCardView stats={{ waiting: 1, overdue: 0, drafts: 0, oldest_hours: 30, open_appeals: 0, grandfathered_unreviewed: 0 }} />,
    );
    expect(screen.getByTestId('pending-applications-oldest')).toHaveAttribute('data-tone', 'due');
    rerender(
      <PendingApplicationsCardView stats={{ waiting: 1, overdue: 0, drafts: 0, oldest_hours: 3, open_appeals: 0, grandfathered_unreviewed: 0 }} />,
    );
    expect(screen.getByTestId('pending-applications-oldest')).toHaveAttribute('data-tone', 'ontime');
    expect(screen.getByTestId('pending-applications-oldest')).toHaveTextContent('Oldest waiting 3 hours');
  });

  it('says the queue is clear when nobody is waiting', () => {
    render(
      <PendingApplicationsCardView stats={{ waiting: 0, overdue: 0, drafts: 4, oldest_hours: 0, open_appeals: 0, grandfathered_unreviewed: 0 }} />,
    );
    expect(screen.getByTestId('pending-applications-count')).toHaveTextContent('0');
    expect(screen.getByText(/queue is clear/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pending-applications-oldest')).toBeNull();
    expect(screen.getByText(/4 still drafting/)).toBeInTheDocument();
  });

  it('says so when the numbers could not load, instead of showing zero', () => {
    render(<PendingApplicationsCardView stats={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.queryByTestId('pending-applications-count')).toBeNull();
  });
});
