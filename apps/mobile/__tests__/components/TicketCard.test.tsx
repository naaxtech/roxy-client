// Mock QR code library — SVG doesn't render in Jest (must be before imports)
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return function MockQRCode({ testID }: { testID?: string }) {
    return <View testID={testID ?? 'qr-mock'} />;
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';
import { TicketCard } from '../../components/TicketCard';

const baseProps = {
  eventTitle: 'WLW Social Mixer',
  startsAt: '2026-04-12T19:00:00Z',
  locationText: 'The Garden Bar, Manila',
  communityName: 'Queer Manila',
  ticketCode: 'ROXY-A3F9BC12',
};

describe('TicketCard', () => {
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
