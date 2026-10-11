import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardError from '@/app/(dashboard)/error';

const mockLogError = jest.fn();
jest.mock('@/lib/errorLogger', () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

describe('(dashboard)/error', () => {
  it('keeps staff inside Studio, says nothing was lost, logs once and retries', () => {
    const reset = jest.fn();
    const err = Object.assign(new Error('relation "x" does not exist'), { digest: 'abc123' });
    render(<DashboardError error={err} reset={reset} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load this page/i);
    expect(screen.queryByText(/relation "x"/)).not.toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
  });
});
