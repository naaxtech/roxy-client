import React from 'react';
import { render, screen } from '@testing-library/react';
import { Notice } from '@/components/Notice';

describe('Notice', () => {
  it('puts the title in foreground colour, not amber', () => {
    render(
      <Notice title="Connect Stripe to enable paid events">
        You&apos;ll need this to collect payments from attendees and customers.
      </Notice>,
    );
    const title = screen.getByText('Connect Stripe to enable paid events');
    expect(title.className).toMatch(/text-foreground/);
    expect(title.className).not.toMatch(/amber|yellow/);
    expect(screen.getByText(/collect payments/i).className).toMatch(/text-muted-foreground/);
  });
});
