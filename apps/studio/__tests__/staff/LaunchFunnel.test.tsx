import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { parseFunnel, pct } from '@/lib/launchFunnel';
import { LaunchFunnelView } from '@/app/(dashboard)/staff/LaunchFunnelView';

const RAW = {
  accounts: 120,
  profiles: 110,
  applications_started: 90,
  applications_submitted: 60,
  applications_pending: 12,
  approved: 40,
  rejected: 8,
  members_approved: 41,
  suspended: 2,
  reports_pending: 3,
  waves: [
    { label: 'Wave 2', codes: 50, redemptions: 10, applications: 8, approved: 3, first_created: '2026-10-05T00:00:00Z' },
    { label: 'Wave 1', codes: 20, redemptions: 18, applications: 15, approved: 12, first_created: '2026-09-20T00:00:00Z' },
  ],
};

describe('parseFunnel', () => {
  it('reads numbers (bigint arrives as number or string) and waves', () => {
    const f = parseFunnel({ ...RAW, accounts: '120' });
    expect(f?.accounts).toBe(120);
    expect(f?.waves).toHaveLength(2);
    expect(f?.waves[0]).toEqual({ label: 'Wave 2', codes: 50, redemptions: 10, applications: 8, approved: 3 });
  });

  it('returns null for something that is not a funnel', () => {
    expect(parseFunnel(null)).toBeNull();
    expect(parseFunnel('nope')).toBeNull();
    expect(parseFunnel({ waves: 'x' })).toBeNull();
  });
});

describe('pct', () => {
  it('rounds and guards division by zero', () => {
    expect(pct(1, 3)).toBe('33%');
    expect(pct(0, 0)).toBe('—');
  });
});

describe('LaunchFunnelView', () => {
  it('shows each funnel step with its conversion from the step before', () => {
    render(<LaunchFunnelView funnel={parseFunnel(RAW)!} />);
    const steps = screen.getByRole('list', { name: /launch funnel/i });
    expect(within(steps).getByText('Accounts')).toBeInTheDocument();
    expect(within(steps).getByText('120')).toBeInTheDocument();
    expect(within(steps).getByText('Applied')).toBeInTheDocument();
    expect(within(steps).getByText('60')).toBeInTheDocument();
    expect(within(steps).getByText('67% of started')).toBeInTheDocument();
    expect(within(steps).getByText('Approved')).toBeInTheDocument();
    expect(within(steps).getByText('67% of applied')).toBeInTheDocument();
  });

  it('lists waves with redemption and approval counts', () => {
    render(<LaunchFunnelView funnel={parseFunnel(RAW)!} />);
    const table = screen.getByRole('table', { name: /waves/i });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Wave 2')).toBeInTheDocument();
    expect(within(rows[1]).getByText('10 / 50')).toBeInTheDocument();
  });

  it('links pending reports and suspensions to their queues', () => {
    render(<LaunchFunnelView funnel={parseFunnel(RAW)!} />);
    expect(screen.getByRole('link', { name: /3 pending reports/i })).toHaveAttribute('href', '/staff/reports');
    expect(screen.getByRole('link', { name: /12 applications waiting/i })).toHaveAttribute('href', '/applications');
  });

  it('says there are no waves yet instead of an empty table', () => {
    render(<LaunchFunnelView funnel={parseFunnel({ ...RAW, waves: [] })!} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/no invite waves yet/i)).toBeInTheDocument();
  });
});
