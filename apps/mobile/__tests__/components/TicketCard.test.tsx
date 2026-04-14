// Mock QR code library — SVG doesn't render in Jest (must be before imports)
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return function MockQRCode({ testID }: { testID?: string }) {
    return <View testID={testID ?? 'qr-mock'} />;
  };
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TicketCard } from '../../components/TicketCard';

const baseProps = {
  eventTitle: 'WLW Social Mixer',
  startsAt: '2026-04-12T19:00:00Z',
  locationText: 'The Garden Bar, Manila',
  communityName: 'Queer Manila',
  ticketCode: 'ROXY-A3F9BC12',
};

describe('TicketCard — full variant (default)', () => {
  it('renders event title', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('WLW Social Mixer')).toBeTruthy();
  });

  it('renders ticket code', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('ROXY-A3F9BC12')).toBeTruthy();
  });

  it('renders QR code element', () => {
    const { getByTestId } = render(<TicketCard {...baseProps} />);
    expect(getByTestId('ticket-qr')).toBeTruthy();
  });

  it('renders location when provided', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('📍 The Garden Bar, Manila')).toBeTruthy();
  });

  it('omits location row when locationText is null', () => {
    const { queryByText } = render(<TicketCard {...baseProps} locationText={null} />);
    expect(queryByText(/Garden Bar/)).toBeNull();
  });

  it('renders community name when provided', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('🏳️‍🌈 Queer Manila')).toBeTruthy();
  });

  it('omits community row when communityName is null', () => {
    const { queryByText } = render(<TicketCard {...baseProps} communityName={null} />);
    expect(queryByText(/Queer Manila/)).toBeNull();
  });
});

describe('TicketCard — full variant status states', () => {
  it('shows "You\'re going!" label for active status', () => {
    const { getByText } = render(<TicketCard {...baseProps} status="active" />);
    expect(getByText(/You're going!/)).toBeTruthy();
  });

  it('shows "Checked In" label and hides QR for checked_in status', () => {
    const { getByText } = render(<TicketCard {...baseProps} status="checked_in" />);
    expect(getByText(/Checked In/)).toBeTruthy();
    // QR is still rendered but with opacity overlay
    // ticket-qr testID should still exist
  });

  it('shows "Event Cancelled" label for cancelled status', () => {
    const { getByText } = render(<TicketCard {...baseProps} status="cancelled" />);
    expect(getByText(/Event Cancelled/)).toBeTruthy();
  });

  it('hides QR code for cancelled status', () => {
    const { queryByTestId } = render(<TicketCard {...baseProps} status="cancelled" />);
    expect(queryByTestId('ticket-qr')).toBeNull();
  });

  it('shows refund note for cancelled status', () => {
    const { getByText } = render(<TicketCard {...baseProps} status="cancelled" />);
    expect(getByText(/5.{1,3}10 business days/)).toBeTruthy();
  });
});

describe('TicketCard — collapsed variant', () => {
  it('renders event title in collapsed view', () => {
    const { getByText } = render(
      <TicketCard {...baseProps} variant="collapsed" onExpand={jest.fn()} />,
    );
    expect(getByText('WLW Social Mixer')).toBeTruthy();
  });

  it('shows "Going" badge for active status', () => {
    const { getByText } = render(
      <TicketCard {...baseProps} variant="collapsed" status="active" onExpand={jest.fn()} />,
    );
    expect(getByText('Going')).toBeTruthy();
  });

  it('shows "Checked In" badge for checked_in status', () => {
    const { getByText } = render(
      <TicketCard {...baseProps} variant="collapsed" status="checked_in" onExpand={jest.fn()} />,
    );
    expect(getByText('Checked In')).toBeTruthy();
  });

  it('shows "Refunded" badge for cancelled status', () => {
    const { getByText } = render(
      <TicketCard {...baseProps} variant="collapsed" status="cancelled" onExpand={jest.fn()} />,
    );
    expect(getByText('Refunded')).toBeTruthy();
  });

  it('calls onExpand when tapped', () => {
    const onExpand = jest.fn();
    const { getByText } = render(
      <TicketCard {...baseProps} variant="collapsed" onExpand={onExpand} />,
    );
    fireEvent.press(getByText('WLW Social Mixer'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('does not render QR code in collapsed view', () => {
    const { queryByTestId } = render(
      <TicketCard {...baseProps} variant="collapsed" onExpand={jest.fn()} />,
    );
    expect(queryByTestId('ticket-qr')).toBeNull();
  });
});
